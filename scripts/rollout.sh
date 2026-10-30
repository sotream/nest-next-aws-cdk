#!/usr/bin/env bash
# Rolls one stack to a pinned starter commit: infrastructure, image build, migration, services.
# Shared by the deploy and preview workflows. Tags are immutable, so an existing image is reused.
#
# Usage: rollout.sh STACK ENV_NAME STARTER_DIR
# Environment: STARTER_REF (full commit SHA), REGISTRY (ECR registry host). Writes `origin` to GITHUB_OUTPUT.
set -euo pipefail

stack=$1
env_name=$2
starter_dir=$3

deploy() {
  pnpm exec cdk deploy "$stack" --require-approval never --outputs-file outputs.json -c "env=$env_name" "$@"
}
out() { jq -r --arg s "$stack" --arg k "$1" '.[$s][$k]' outputs.json; }

# 1. Infrastructure. Services stay on the image they run now; on the first deployment that is none.
current=$(scripts/current-image-tag.sh "$stack" "$stack-api")
echo "Running now: ${current:-nothing}"
deploy -c "imageTag=$current" -c "migrateImageTag=$current"
origin=$(out Origin)
echo "origin=$origin" >> "${GITHUB_OUTPUT:-/dev/null}"

# 2. Images. The web image inlines the origin at build time, so the tag includes a hash of it: the same
# commit under a new origin builds a new image.
tag="${STARTER_REF::12}-$(printf %s "$origin" | sha256sum | cut -c1-8)"
exists() { aws ecr describe-images --repository-name "$1" --image-ids "imageTag=$tag" >/dev/null 2>&1; }
if exists nest-next/api; then echo "api:$tag already in ECR"; else
  docker build -f "$starter_dir/apps/api/Dockerfile" -t "$REGISTRY/nest-next/api:$tag" "$starter_dir"
  docker push "$REGISTRY/nest-next/api:$tag"
fi
if exists nest-next/web; then echo "web:$tag already in ECR"; else
  docker build -f "$starter_dir/apps/web/Dockerfile" --build-arg "NEXT_PUBLIC_API_URL=$origin" \
    -t "$REGISTRY/nest-next/web:$tag" "$starter_dir"
  docker push "$REGISTRY/nest-next/web:$tag"
fi

# 3. Register the migration task for the new image, run it once and require a clean exit.
deploy -c "imageTag=$current" -c "migrateImageTag=$tag"
scripts/run-migration.sh "$(out ClusterName)" "$(out MigrationTaskDefinition)" \
  "$(out PrivateSubnets)" "$(out MigrationSecurityGroup)"

# 4. Roll the services. The deploy waits for a steady state; the circuit breaker rolls back a bad rollout.
deploy -c "imageTag=$tag"

#!/usr/bin/env bash
# Destroys preview stacks whose pull request is closed or that are older than MAX_AGE_DAYS.
# Safety net for the on-close workflow: orphaned previews cost money.
#
# Usage: cleanup-previews.sh
# Environment: GH_TOKEN, GITHUB_REPOSITORY, optional DRY_RUN=true and MAX_AGE_DAYS.
set -euo pipefail

stacks=$(aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE ROLLBACK_COMPLETE CREATE_FAILED DELETE_FAILED \
  --query 'StackSummaries[?starts_with(StackName, `nest-next-pr-`)].{name: StackName, createdAt: CreationTime}' \
  --output json)

candidates='[]'
for name in $(jq -r '.[].name' <<<"$stacks"); do
  number=${name#nest-next-pr-}
  state=$(gh pr view "$number" --repo "$GITHUB_REPOSITORY" --json state --jq .state 2>/dev/null || echo CLOSED)
  candidates=$(jq --arg n "$name" --arg s "$state" --argjson all "$stacks" \
    '. + [($all[] | select(.name == $n) + {prState: $s})]' <<<"$candidates")
done

for name in $(scripts/select-orphaned-previews.sh <<<"$candidates"); do
  if [ "${DRY_RUN:-false}" = "true" ]; then
    echo "Would destroy $name"
  else
    echo "Destroying $name"
    pnpm exec cdk destroy "$name" --force -c "env=pr-${name#nest-next-pr-}"
  fi
done

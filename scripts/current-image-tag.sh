#!/usr/bin/env bash
# Prints the image tag the given ECS service runs right now, or nothing when the service does not exist.
# The deploy workflow uses it instead of a stack output: an output can name a tag that is not running when
# a rollout failed and ECS rolled back.
#
# Usage: current-image-tag.sh CLUSTER SERVICE
set -euo pipefail

cluster=$1
service=$2

task_definition=$(aws ecs describe-services --cluster "$cluster" --services "$service" \
  --query 'services[?status==`ACTIVE`] | [0].taskDefinition' --output text)

if [ -z "$task_definition" ] || [ "$task_definition" = "None" ]; then
  exit 0
fi

image=$(aws ecs describe-task-definition --task-definition "$task_definition" \
  --query 'taskDefinition.containerDefinitions[0].image' --output text)

# repository:tag; a digest reference has no tag.
last=${image##*/}
case "$last" in
  *@*) exit 0 ;;
  *:*) echo "${last##*:}" ;;
esac

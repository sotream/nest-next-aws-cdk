#!/usr/bin/env bash
# Runs the migration task once and fails unless it exits 0.
#
# Usage: run-migration.sh CLUSTER TASK_DEFINITION SUBNETS SECURITY_GROUP
# SUBNETS is a comma-separated list.
set -euo pipefail

cluster=$1
task_definition=$2
subnets=$3
security_group=$4

task_arn=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE --task-definition "$task_definition" \
  --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "Migration task: $task_arn"

aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn"
exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)

if [ "$exit_code" != "0" ]; then
  aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --query 'tasks[0].stoppedReason' --output text
  echo "::error::Migration exited with code $exit_code. Services were not updated."
  exit 1
fi

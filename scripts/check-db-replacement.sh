#!/usr/bin/env bash
# Reads `cdk diff` output on stdin and fails when it would replace or delete the database.
# Pass ALLOW_DB_REPLACEMENT=true to let it through.
set -euo pipefail

diff_output=$(cat)

if grep -Eq 'AWS::RDS::DBInstance.*(replace|destroy)' <<<"$diff_output"; then
  if [ "${ALLOW_DB_REPLACEMENT:-false}" = "true" ]; then
    echo "::warning::The deploy replaces the database; allowed by input."
    exit 0
  fi
  echo "::error::The deploy would replace or delete the database. Re-run with allow_db_replacement only if that is intended and a backup exists."
  exit 1
fi

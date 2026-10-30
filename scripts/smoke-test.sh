#!/usr/bin/env bash
# Checks the readiness endpoint of the API and the sign-in page through the public origin.
#
# Usage: smoke-test.sh ORIGIN
set -euo pipefail

origin=${1%/}

curl --fail --silent --show-error --retry 10 --retry-delay 6 --retry-all-errors "$origin/api/health/ready"
echo
curl --fail --silent --show-error --retry 5 --retry-delay 6 --retry-all-errors "$origin/sign-in" > /dev/null
echo "Smoke test passed: $origin"

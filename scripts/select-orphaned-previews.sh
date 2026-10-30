#!/usr/bin/env bash
# Reads a JSON list of preview stacks on stdin and prints the names that should be destroyed: the pull
# request is not open any more, or the stack is older than MAX_AGE_DAYS (default 7).
#
# Input:  [{"name": "nest-next-pr-7", "createdAt": "2026-10-30T18:07:50.123000+00:00", "prState": "OPEN"}]
# Environment: NOW (epoch seconds, default: current time), MAX_AGE_DAYS.
set -euo pipefail

jq -r --argjson now "${NOW:-$(date +%s)}" --argjson max "${MAX_AGE_DAYS:-7}" '
  .[]
  | select(
      .prState != "OPEN"
      or ($now - (.createdAt | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601)) > ($max * 86400)
    )
  | .name'

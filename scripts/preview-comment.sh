#!/usr/bin/env bash
# Creates or updates the one preview comment on a pull request.
#
# Usage: preview-comment.sh PR_NUMBER MESSAGE
# Environment: GH_TOKEN, GITHUB_REPOSITORY.
set -euo pipefail

pr=$1
message=$2
marker='<!-- nest-next-preview -->'
body="$marker"$'\n'"$message"

existing=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n 1)

if [ -n "$existing" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -f body="$body" >/dev/null
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -f body="$body" >/dev/null
fi

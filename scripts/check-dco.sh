#!/usr/bin/env bash
# Developer Certificate of Origin check (https://developercertificate.org).
# Every non-merge commit in the range must have "Signed-off-by: <author name> <author email>".
# Usage: scripts/check-dco.sh <base>..<head>
set -euo pipefail

range="${1:?usage: check-dco.sh <base>..<head>}"
status=0

for sha in $(git rev-list --no-merges "$range"); do
  author=$(git show -s --format='%an <%ae>' "$sha")
  signed=0
  while IFS= read -r value; do
    value="${value%"${value##*[![:space:]]}"}"
    if [ "$value" = "$author" ]; then signed=1; fi
  done < <(git show -s --format='%(trailers:key=Signed-off-by,valueonly,unfold)' "$sha")

  if [ "$signed" -eq 0 ]; then
    echo "DCO: commit ${sha:0:12} has no 'Signed-off-by: $author' line." >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "Sign off each commit with: git commit -s" >&2
  echo "To sign off existing commits: git rebase --signoff <base>" >&2
fi
exit "$status"

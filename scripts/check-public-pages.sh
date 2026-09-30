#!/usr/bin/env bash
# AC13: every URL in sitemap.xml must be byte-identical to main on any non-main
# branch, unless the change is declared (with a reason) in scripts/public-changes.txt
# so that reviewers see it in the PR. ALLOW_PUBLIC_CHANGE=1 skips the check entirely.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin main
declared=$(grep -vE '^\s*(#|$)' scripts/public-changes.txt 2>/dev/null | cut -f1 || true)
changed=0
for url in $(grep -oE '<loc>[^<]+</loc>' sitemap.xml | sed -E 's#</?loc>##g'); do
  path=$(echo "$url" | sed -E 's#https?://[^/]+/##'); [ -z "$path" ] && path=index.html
  if ! git diff --quiet origin/main -- "$path"; then
    if echo "$declared" | grep -qx "$path"; then echo "public page changed (declared in scripts/public-changes.txt): $path";
    else echo "public page changed: $path"; changed=1; fi
  fi
done
if [ "${ALLOW_PUBLIC_CHANGE:-}" = "1" ]; then exit 0; fi
[ $changed -eq 0 ] && echo "AC13 ok: no undeclared public page changes" || { echo "Declare an intentional change in scripts/public-changes.txt with a reason, or set ALLOW_PUBLIC_CHANGE=1."; exit 1; }

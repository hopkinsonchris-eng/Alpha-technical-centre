#!/usr/bin/env bash
# AC13: every URL in sitemap.xml must be byte-identical to main on any non-main branch.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin main
changed=0
for url in $(grep -oE '<loc>[^<]+</loc>' sitemap.xml | sed -E 's#</?loc>##g'); do
  path=$(echo "$url" | sed -E 's#https?://[^/]+/##'); [ -z "$path" ] && path=index.html
  if ! git diff --quiet origin/main -- "$path"; then echo "public page changed: $path"; changed=1; fi
done
if [ "${ALLOW_PUBLIC_CHANGE:-}" = "1" ]; then exit 0; fi
[ $changed -eq 0 ] && echo "AC13 ok: public pages unchanged" || { echo "Set ALLOW_PUBLIC_CHANGE=1 for an intentional public change."; exit 1; }

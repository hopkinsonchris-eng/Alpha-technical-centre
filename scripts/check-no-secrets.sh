#!/usr/bin/env bash
# AC12: no provider key, token or password may appear in any file served to the browser.
set -euo pipefail
cd "$(dirname "$0")/.."
patterns='sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|pa-[A-Za-z0-9_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
files=$(git ls-files -- '*.html' '*.js' '*.css' '*.json' '*.svg' '*.txt' '*.xml' 'hub/**' 'js/**' | grep -vE '^(vault/|docs/|\.github/|scripts/|test/)' || true)
hits=$(echo "$files" | xargs -r grep -nE "$patterns" || true)
if [ -n "$hits" ]; then echo "Secret-like strings in served files:"; echo "$hits"; exit 1; fi
echo "AC12 ok: no secret-like strings in served files"

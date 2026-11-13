#!/usr/bin/env bash
# Rebuild the viewer and regenerate a site (default: the sample project).
set -euo pipefail
cd "$(dirname "$0")/.."
project=${1:-examples/sample}
out=${2:-out/$(basename "$project")}
npm run build -s -w @vernissage/viewer >/dev/null
npm run build -s -w @vernissage/generator >/dev/null
node packages/generator/dist/cli.js build "$project" --out "$out" | tail -3

#!/usr/bin/env bash
# gait:name build
# gait:description Build extension and webview bundles
# gait:expect exit:0
# gait:timeout 120s
# gait:depends lint, typecheck
set -euo pipefail

npm run compile

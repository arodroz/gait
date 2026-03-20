#!/usr/bin/env bash
# gait:name lint
# gait:description Run TypeScript type checker as linter
# gait:expect exit:0
# gait:timeout 120s
set -euo pipefail

npx tsc --noEmit

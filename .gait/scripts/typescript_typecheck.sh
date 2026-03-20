#!/usr/bin/env bash
# gait:name typecheck
# gait:description Run TypeScript type checker
# gait:expect exit:0
# gait:timeout 120s
set -euo pipefail

npx tsc --noEmit

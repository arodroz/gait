#!/usr/bin/env bash
# gait:name test
# gait:description Run all tests with vitest
# gait:expect exit:0
# gait:timeout 120s
# gait:depends lint
set -euo pipefail

npx vitest run

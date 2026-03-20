#!/usr/bin/env bash
# gait:name test
# gait:description Run typescript tests
# gait:expect exit:0
# gait:timeout 120s
# gait:depends lint
set -euo pipefail

npx vitest run

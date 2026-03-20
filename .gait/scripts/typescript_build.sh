#!/usr/bin/env bash
# gait:name build
# gait:description Build typescript project
# gait:expect exit:0
# gait:timeout 120s
set -euo pipefail

npm run build

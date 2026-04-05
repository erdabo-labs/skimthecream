#!/bin/bash
# Wrapper that loads env vars and runs a compiled service
cd /Users/erikbowen/erdabo-labs/skimthecream
source .envrc 2>/dev/null
exec /usr/local/bin/node "dist/services/$1.js"

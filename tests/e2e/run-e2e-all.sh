#!/usr/bin/env bash
set -euo pipefail

# debug info
echo "Node version: $(node --version)"
echo "Deno version: $(deno --version | head -n 1)"

echo "Building the library..."
bun run build

DIRNAME=$(dirname "$0")
echo "Running all e2e smoke tests"
echo "--------------------------------"


echo "Running Node.js e2e smoke test..."
"$DIRNAME/run-e2e-node.mjs"
echo "Node.js e2e smoke test passed"
echo "--------------------------------"
echo "Running Deno e2e smoke test..."
"$DIRNAME/run-e2e-deno.ts"
echo "Deno e2e smoke test passed"
echo "--------------------------------"

echo "All e2e smoke tests passed"

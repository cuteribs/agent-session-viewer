#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ── 1. Build the Vue client ─────────────────────────────────────────────────
echo ">>> Building client..."
pushd client > /dev/null
npm install --silent
npm run build --silent
popd > /dev/null

# ── 2. Copy client dist into the Go server's static directory ──────────────
# The Go binary serves files from <binary-dir>/dist/public/
echo ">>> Copying client assets to server-go/dist/public/..."
rm -rf server-go/dist/public
mkdir -p server-go/dist/public
cp -r client/dist/. server-go/dist/public/

# ── 3. Build the Go server ──────────────────────────────────────────────────
echo ">>> Building Go server..."
pushd server-go > /dev/null
go build -o agent-session-viewer .
popd > /dev/null

# ── 4. Launch ───────────────────────────────────────────────────────────────
echo ">>> Starting Agent Session Viewer..."
exec server-go/agent-session-viewer

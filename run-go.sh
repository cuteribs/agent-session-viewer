#!/usr/bin/env bash

# ── 1. Build the Vue client ─────────────────────────────────────────────────
echo ">>> Building client..."
pushd client
npm install
npm run build
popd

# ── 2. Copy client dist into the Go server's static directory ──────────────
# The Go binary serves files from <binary-dir>/dist/public/
echo ">>> Copying client assets to server-go/dist/public/..."
rm -rf server-go/dist/public
mkdir -p server-go/dist/public
cp -r client/dist/. server-go/dist/public/

# ── 3. Build the Go server ──────────────────────────────────────────────────
echo ">>> Building Go server..."
pushd server-go
go build -o agent-session-viewer .
popd

# ── 4. Launch ───────────────────────────────────────────────────────────────
echo ">>> Starting Agent Session Viewer..."
exec server-go/agent-session-viewer

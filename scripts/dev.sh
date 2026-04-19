#!/bin/bash
# scripts/dev.sh — boot the full gmacko stack
set -e

echo "=== Gmacko Dev Stack ==="

# 1. Migrate database
echo "[1/2] Migrating database..."
cd packages/db && pnpm db:migrate:pglite && cd ../..

# 2. Start web (hosts the Effect-RPC route handler)
echo "[2/2] Starting Next.js on :3000..."
cd apps/web && pnpm dev &
WEB_PID=$!

echo ""
echo "Stack running:"
echo "  Web:    http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all"

trap "kill $WEB_PID 2>/dev/null" EXIT
wait

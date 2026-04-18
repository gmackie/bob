#!/bin/bash
# scripts/dev.sh — boot the full gmacko stack
set -e

echo "=== Gmacko Dev Stack ==="

# 1. Migrate database
echo "[1/3] Migrating database..."
cd packages/db && pnpm db:migrate:pglite && cd ../..

# 2. Start server
echo "[2/3] Starting Effect server on :3001..."
cd apps/server && pnpm dev &
SERVER_PID=$!
sleep 2

# 3. Start web
echo "[3/3] Starting Next.js on :3000..."
cd apps/web && pnpm dev &
WEB_PID=$!

echo ""
echo "Stack running:"
echo "  Server: http://localhost:3001"
echo "  Web:    http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all"

trap "kill $SERVER_PID $WEB_PID 2>/dev/null" EXIT
wait

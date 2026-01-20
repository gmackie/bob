#!/bin/bash
# Development script for mobile app with ngrok tunnel for API
# Expo handles its own tunnel via --tunnel flag

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Temp files
NEXT_LOG="/tmp/bob-next.log"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Bob Mobile Development${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check for ngrok
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}Error: ngrok is not installed${NC}"
    echo ""
    echo "Install ngrok:"
    echo "  brew install ngrok    # macOS"
    echo "  npm install -g ngrok  # or via npm"
    echo ""
    echo "Then authenticate with: ngrok authtoken YOUR_TOKEN"
    echo "Get your token at: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

# Check for jq (used for parsing JSON)
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is not installed${NC}"
    echo ""
    echo "Install jq:"
    echo "  brew install jq    # macOS"
    exit 1
fi

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    
    # Kill background processes
    [ -n "$NEXT_PID" ] && kill $NEXT_PID 2>/dev/null || true
    [ -n "$NGROK_PID" ] && kill $NGROK_PID 2>/dev/null || true
    
    # Clean up temp files
    rm -f "$NEXT_LOG"
    rm -f "$NGROK_LOG" 2>/dev/null || true
    
    echo -e "${GREEN}Goodbye!${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Function to extract port from Next.js output
get_next_port() {
    grep -oE 'Local:[[:space:]]*http://localhost:[0-9]+' "$NEXT_LOG" 2>/dev/null | grep -oE '[0-9]+$' | head -1
}

is_port_listening() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_http() {
    local port="$1"
    for i in {1..60}; do
        if curl -s --max-time 1 "http://127.0.0.1:${port}" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

pick_expo_port() {
    local base=8081
    local max=8091

    for ((p=base; p<=max; p++)); do
        if ! is_port_listening "$p"; then
            echo "$p"
            return 0
        fi
    done

    return 1
}

is_next_lock_present() {
    [ -f /Volumes/dev/bob/apps/nextjs/.next/dev/lock ]
}

find_bob_next_dev_pids() {
    ps aux | awk 'BEGIN{p=0} /\/Volumes\/dev\/bob\/apps\/nextjs\/node_modules\/.bin\/next dev/ {print $2}'
}

kill_bob_next_dev() {
    local pids
    pids=$(find_bob_next_dev_pids)

    if [ -z "$pids" ]; then
        return 0
    fi

    echo "$pids" | xargs kill 2>/dev/null || true

    sleep 1

    local remaining
    remaining=$(find_bob_next_dev_pids)
    if [ -n "$remaining" ]; then
        echo "$remaining" | xargs kill -9 2>/dev/null || true
    fi
}

# ============================================
# Step 1: Start Next.js and get its port
# ============================================
echo -e "${YELLOW}[1/3] Starting Next.js server...${NC}"

if is_next_lock_present; then
    echo -e "${YELLOW}      Detected Next.js dev lock file.${NC}"
    echo -e "${YELLOW}      This usually means another Bob Next.js dev server is running.${NC}"

    EXISTING_PIDS=$(find_bob_next_dev_pids)
    if [ -n "$EXISTING_PIDS" ]; then
        echo -e "${YELLOW}      Detected running Next.js dev PID(s):${NC} $EXISTING_PIDS"
    else
        echo -e "${YELLOW}      No Bob Next.js dev processes detected, but lock still exists.${NC}"
    fi

    if [ "${BOB_DEV_MOBILE_AUTO_KILL:-}" = "1" ]; then
        kill_bob_next_dev
        rm -f /Volumes/dev/bob/apps/nextjs/.next/dev/lock 2>/dev/null || true
    else
        if [ ! -t 0 ]; then
            echo -e "${RED}Error: Next.js dev lock present and script is running non-interactively.${NC}"
            echo -e "${YELLOW}      Re-run in an interactive terminal, or set BOB_DEV_MOBILE_AUTO_KILL=1.${NC}"
            exit 1
        fi

        read -p "Kill existing Bob Next.js dev process(es) and continue? [y/N] " -r
        if [[ "$REPLY" =~ ^[Yy]$ ]]; then
            kill_bob_next_dev
            rm -f /Volumes/dev/bob/apps/nextjs/.next/dev/lock 2>/dev/null || true
        else
            echo -e "${RED}Error: Next.js dev lock present; refusing to start a second instance.${NC}"
            exit 1
        fi
    fi
fi

> "$NEXT_LOG"
pnpm --filter @bob/nextjs dev > "$NEXT_LOG" 2>&1 &
NEXT_PID=$!

echo -e "      Waiting for Next.js to be ready..."
NEXT_PORT=""
for i in {1..60}; do
    if ! kill -0 "$NEXT_PID" 2>/dev/null; then
        if grep -q "Unable to acquire lock" "$NEXT_LOG" 2>/dev/null; then
            echo -e "${RED}Error: Next.js failed to acquire dev lock (another instance running).${NC}"
            echo "Last log output:"
            tail -50 "$NEXT_LOG"
            exit 1
        fi

        echo -e "${RED}Error: Next.js process exited early${NC}"
        echo "Last log output:"
        tail -50 "$NEXT_LOG"
        exit 1
    fi

    NEXT_PORT=$(get_next_port)
    if [ -n "$NEXT_PORT" ]; then
        break
    fi
    sleep 1
done

if [ -z "$NEXT_PORT" ]; then
    echo -e "${RED}Error: Could not detect Next.js port after 60 seconds${NC}"
    echo "Last log output:"
    tail -50 "$NEXT_LOG"
    exit 1
fi

if ! wait_for_http "$NEXT_PORT"; then
    echo -e "${RED}Error: Next.js did not become reachable on port ${NEXT_PORT}${NC}"
    echo "Last log output:"
    tail -50 "$NEXT_LOG"
    exit 1
fi

echo -e "${GREEN}      Next.js running on port ${NEXT_PORT}${NC}"

# ============================================
# Step 2: Start ngrok tunnel for API
# ============================================
echo -e "${YELLOW}[2/3] Starting ngrok tunnel for API...${NC}"

NGROK_LOG="/tmp/ngrok-bob-$$.log"
NGROK_URL="https://bob-dev.ngrok.app"

# Start ngrok with static domain
ngrok http "127.0.0.1:${NEXT_PORT}" --url="$NGROK_URL" --log=stdout --log-level=info > "$NGROK_LOG" 2>&1 &
NGROK_PID=$!

echo -e "      Waiting for ngrok tunnel..."
API_URL=""
for i in {1..20}; do
    # Check if tunnel is established by looking for success in logs
    if grep -q "started tunnel" "$NGROK_LOG" 2>/dev/null || grep -q "client session established" "$NGROK_LOG" 2>/dev/null; then
        # Verify tunnel is actually working
        if curl -s --head "$NGROK_URL" >/dev/null 2>&1; then
            API_URL="$NGROK_URL"
            break
        fi
    fi
    
    # Check for errors
    if grep -q "ERR_NGROK" "$NGROK_LOG" 2>/dev/null; then
        echo -e "${RED}Error: ngrok failed to start${NC}"
        tail -20 "$NGROK_LOG"
        exit 1
    fi
    
    sleep 1
done

if [ -z "$API_URL" ]; then
    echo -e "${RED}Error: Could not establish ngrok tunnel${NC}"
    echo "Ngrok log:"
    tail -20 "$NGROK_LOG"
    exit 1
fi

echo -e "${GREEN}      API tunnel: ${API_URL}${NC}"

# ============================================
# Step 3: Start Expo with API URL and tunnel
# ============================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Development environment ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Next.js:${NC}      http://localhost:${NEXT_PORT}"
echo -e "${BLUE}API tunnel:${NC}   ${API_URL}"
echo -e "${BLUE}tRPC:${NC}         ${API_URL}/api/trpc"
echo ""
echo -e "${YELLOW}[3/3] Starting Expo development client...${NC}"
echo -e "      API_URL=${API_URL}"
echo -e "      APP_ENV=development"
echo ""
echo -e "${YELLOW}Make sure you have a development build installed:${NC}"
echo -e "      eas build --profile development --platform ios"
echo -e "      eas build --profile development --platform android"
echo ""
echo -e "${YELLOW}Scan the QR code with your phone camera to open in dev client${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all servers${NC}"
echo ""

# Run Expo in foreground with the API URL and dev client
cd apps/expo
EXPO_PORT=$(pick_expo_port)
APP_ENV=development API_URL="$API_URL" npx expo start --dev-client --tunnel --port "$EXPO_PORT"

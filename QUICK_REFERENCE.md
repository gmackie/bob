# Quick Reference - Build Modes

## Three Build Modes

### 1. 🔵 Standard Bob Mode (Production Web)
```bash
USE_GITHUB_AUTH=true npm run dev
npm run build:app
npm run dist
```
- **Name**: Bob
- **Auth**: GitHub OAuth enabled when `USE_GITHUB_AUTH=true`
- **Agents**: All available (Claude, Codex, Gemini, Amazon Q, OpenCode, Cursor)
- **Use Case**: Production web deployment with authentication

### 2. 🟢 No-Auth Bob Mode (Electron Desktop)
```bash
npm run build:app:no-auth
npm run dev
```
- **Name**: Bob
- **Auth**: Disabled
- **Agents**: All available
- **Use Case**: Electron desktop app without GitHub OAuth

### 3. 🟡 Jeff Mode (Amazon Q Only)
```bash
npm run dev:jeff
npm run build:app:jeff
npm run dist:jeff
```
- **Name**: Jeff
- **Auth**: Disabled
- **Agents**: Amazon Q only
- **Use Case**: Restricted build for Amazon Q users

---

## Environment Variables

| Variable | Default | Jeff Mode | Description |
|----------|---------|-----------|-------------|
| `USE_GITHUB_AUTH` | `false` | `false` | Enable/disable GitHub OAuth |
| `JEFF_MODE` | `false` | `true` | Enable Jeff mode (renames app, filters agents) |
| `APP_NAME` | `Bob` | `Bob` | Custom app name (overridden by JEFF_MODE) |

---

## Quick Commands

```bash
# Development
npm run dev              # Standard mode
npm run dev:jeff         # Jeff mode

# Build Electron Apps
npm run build:app        # Standard with auth
npm run build:app:no-auth # No auth
npm run build:app:jeff   # Jeff mode

# Distribution
npm run dist             # All platforms, standard
npm run dist:linux       # Linux only
npm run dist:mac         # macOS only
npm run dist:win         # Windows only
npm run dist:jeff        # Jeff mode, all platforms

# Production Server
npm start                # Standard mode
npm run start:jeff       # Jeff mode
```

---

## What Changes in Each Mode?

### Standard Mode ✓
- Title: "Bob"
- GitHub login button visible
- All 6 agents available
- Auth required for API access

### No-Auth Mode ✓
- Title: "Bob"
- No GitHub login button
- All 6 agents available
- No auth required for API access

### Jeff Mode ✓
- Title: "Jeff"
- No GitHub login button
- Only Amazon Q agent
- No auth required for API access

---

## Files Modified

### Backend
- `backend/src/config/app.config.ts` (NEW)
- `backend/src/server.ts`
- `backend/src/agents/agent-factory.ts`

### Frontend
- `frontend/src/config/app.config.ts` (NEW)
- `frontend/src/App.tsx`

### Build
- `scripts/set-product-name.js` (NEW)
- `package.json`
- `.env.example`

---

## Testing

```bash
# Test config logic
node /tmp/test-config.js

# Test agent filtering
node /tmp/test-agent-factory.js

# Test all modes
node /tmp/comprehensive-test.js
```

---

## Troubleshooting

**Issue**: Auth still shows when disabled
```bash
# Ensure the flag is off
USE_GITHUB_AUTH=false npm run dev
```

**Issue**: Wrong app name in Electron build
```bash
# Run product name script
node scripts/set-product-name.js
```

**Issue**: Agents not filtering
```bash
# Verify JEFF_MODE is set
echo $JEFF_MODE  # Should output: true
```

---

## Documentation

📖 **BUILD_MODES.md** - Comprehensive usage guide
📊 **TEST_RESULTS.md** - Complete test results
⚙️ **.env.example** - Environment variable reference
🔍 **QUICK_REFERENCE.md** - This file

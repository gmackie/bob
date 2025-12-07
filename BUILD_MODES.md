# Bob Build Modes

This document explains the different build modes and configuration flags available for Bob.

## Overview

Bob supports multiple build configurations to accommodate different deployment scenarios:

1. **Standard Mode** - Full Bob application with all features
2. **No-Auth Mode** - Bob without GitHub authentication (for Electron builds)
3. **Jeff Mode** - Renamed to "Jeff" with only Amazon Q agent available

## Environment Variables

### `USE_GITHUB_AUTH`

Controls whether GitHub OAuth authentication is enabled.

- **Default**: `false` (disabled)
- **Values**: `true` | `false`
- **Use Case**: Set to `true` for deployments that should require GitHub OAuth

**Example**:
```bash
USE_GITHUB_AUTH=true npm run dev
```

### `JEFF_MODE`

Special mode that renames the application to "Jeff" and restricts available agents to Amazon Q only.

- **Default**: `false` (disabled)
- **Values**: `true` | `false`
- **Effects**:
  - App name changes from "Bob" to "Jeff" in UI
  - Only Amazon Q agent is available for selection
  - Automatically disables GitHub auth (recommended)

**Example**:
```bash
JEFF_MODE=true npm run dev
```

### `APP_NAME`

Override the application name (overridden by JEFF_MODE if enabled).

- **Default**: `Bob`
- **Values**: Any string
- **Note**: JEFF_MODE takes precedence

**Example**:
```bash
APP_NAME="My Custom Name" npm run dev
```

## NPM Scripts

### Development

```bash
# Standard development mode
npm run dev

# Development with clean start (recommended when switching branches)
npm run dev:clean

# Jeff mode development
npm run dev:jeff
```

### Building Electron Apps

```bash
# Standard build with all features
npm run build:app

# Build without GitHub auth (for Electron)
npm run build:app:no-auth

# Build Jeff mode (Amazon Q only, no auth)
npm run build:app:jeff

# Directory build (faster, no installer)
npm run build:app:dir
```

### Distribution Builds

```bash
# Standard distribution
npm run dist

# Platform-specific
npm run dist:linux
npm run dist:mac
npm run dist:win

# Jeff mode distribution
npm run dist:jeff
```

### Production Server

```bash
# Standard production server
npm start

# Jeff mode production server
npm run start:jeff
```

## Configuration Details

### Backend Configuration

The backend reads configuration from environment variables in `/backend/src/config/app.config.ts`:

```typescript
{
  name: process.env.APP_NAME || 'Bob',
  enableGithubAuth: process.env.USE_GITHUB_AUTH === 'true',
  jeffMode: process.env.JEFF_MODE === 'true',
  // ... methods for filtering agents
}
```

### Frontend Configuration

The frontend fetches configuration from the backend `/api/config` endpoint, which returns:

```json
{
  "appName": "Bob",
  "enableGithubAuth": true,
  "jeffMode": false,
  "allowedAgents": []
}
```

When `allowedAgents` is empty, all agents are allowed. When `jeffMode` is true, `allowedAgents` will be `["amazon-q"]`.

## Agent Filtering

### Standard Mode
All agents are available:
- Claude
- Codex
- Gemini
- Amazon Q
- OpenCode
- Cursor Agent

### Jeff Mode
Only Amazon Q is available:
- Amazon Q

The filtering happens at two levels:
1. **Backend**: Agent factory only registers allowed agents
2. **Frontend**: Agent selector only shows available agents from backend

## Build Process

When building with custom modes:

1. **Set Environment Variables**: Flags are set via environment variables
2. **Set Product Name**: `scripts/set-product-name.js` updates package.json productName
3. **Build Frontend & Backend**: Standard build process
4. **Electron Builder**: Creates installer with configured product name

## Examples

### Example 1: Local Development with Jeff Mode

```bash
# Terminal 1: Start with Jeff mode
JEFF_MODE=true USE_GITHUB_AUTH=false npm run dev

# Access at http://localhost:47285
# - App title shows "Jeff"
# - No GitHub auth button
# - Only Amazon Q agent available
```

### Example 2: Build Electron App without Auth

```bash
# Build for distribution
USE_GITHUB_AUTH=false npm run build:app

# Result: Bob.exe (or .dmg, .AppImage) without GitHub auth
```

### Example 3: Build Jeff Distribution

```bash
# Build Jeff version for all platforms
npm run dist:jeff

# Results in dist-electron/:
# - Jeff.exe (Windows)
# - Jeff.dmg (macOS)
# - Jeff.AppImage (Linux)
```

### Example 4: Production Server in Jeff Mode

```bash
# Set environment variables
export JEFF_MODE=true
export USE_GITHUB_AUTH=false

# Start production server
npm start

# Or use the convenience script
npm run start:jeff
```

## UI Changes by Mode

### GitHub Auth Disabled
- No "Login with GitHub" button in top-right
- No auth status check
- All API routes are public (no auth middleware)

### Jeff Mode
- Application title changes from "Bob" to "Jeff"
- Agent selector dropdown only shows "Amazon Q"
- System status reflects only Amazon Q availability

## Testing Different Modes

```bash
# Test standard mode
npm run dev:clean
# Visit http://localhost:47285

# Test Jeff mode
npm run dev:jeff
# Visit http://localhost:47285
# Verify: title = "Jeff", only Amazon Q available

# Test no-auth mode
USE_GITHUB_AUTH=false npm run dev:clean
# Verify: no auth button, all agents available
```

## Troubleshooting

### Product Name Not Updating

If the Electron app still shows the old name:
```bash
# Manually run the product name script
node scripts/set-product-name.js

# Check package.json
cat package.json | grep productName
```

### Agents Not Filtering

Verify environment variables are set:
```bash
# Check backend logs on startup
npm run dev:clean

# Look for: "Services initialized"
# Agents should reflect configuration
```

### Auth Still Appearing

Confirm `USE_GITHUB_AUTH` is only set when you want auth turned on:
```bash
# Disable GitHub auth (default)
USE_GITHUB_AUTH=false npm run dev

# Enable GitHub auth explicitly
USE_GITHUB_AUTH=true npm run dev
```

## Notes

- Environment variables must be set BEFORE running build commands
- Jeff mode automatically implies no auth (but you can set both for clarity)
- The app name in package.json is reset to "Bob" by default to avoid git conflicts
- Product name is only changed temporarily during builds via the set-product-name script

# Bob Deployment Modes

> **Document Version**: 1.0.0  
> **Last Updated**: 2026-01-12  
> **Status**: DESIGN - Approved for implementation

Bob supports two primary deployment modes with distinct configurations, security models, and capabilities.

---

## Overview

| Aspect | Desktop Mode | Server Mode |
|--------|-------------|-------------|
| **Target** | Single developer | Team/organization |
| **Users** | Single (implicit) | Multiple (authenticated) |
| **Authentication** | None required | GitHub OAuth + API keys |
| **Database** | SQLite (local file) | Neon Postgres (serverless) |
| **Filesystem** | Local `~/.bob/` | Per-user isolated dirs |
| **Network** | localhost only | Public/internal network |
| **PTY Security** | Full local access | Sandboxed per user |
| **OAuth Callbacks** | localhost ports | ngrok tunnel or stable domain |

---

## Desktop Mode (Default)

### When to Use
- Individual developer workstation
- Local development and testing
- Quick setup without infrastructure
- Offline-capable workflows

### Configuration

```bash
# .env (Desktop Mode)
BOB_MODE=desktop                # Default mode
BOB_AUTH_ENABLED=false          # No authentication required
DATABASE_URL=file:./bob.sqlite  # Local SQLite file
BOB_DATA_DIR=~/.bob            # Data directory
```

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop Machine                       │
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │   Browser   │────│  Frontend   │    │  Backend    │ │
│  │             │    │  :5173      │────│  :3001      │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│                                              │          │
│                                        ┌─────┴─────┐   │
│                                        │  SQLite   │   │
│                                        │  bob.db   │   │
│                                        └───────────┘   │
│                                              │          │
│  ┌──────────────────────────────────────────┴────────┐ │
│  │                    ~/.bob/                         │ │
│  │  ├── worktrees/                                    │ │
│  │  │   ├── project-a-feature/                       │ │
│  │  │   └── project-b-bugfix/                        │ │
│  │  └── bob.sqlite                                    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Agent PTY Processes                 │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │   │
│  │  │ OpenCode │ │  Claude  │ │  Gemini  │        │   │
│  │  └──────────┘ └──────────┘ └──────────┘        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Characteristics

**User Identity**
- Single implicit user (`default-user`)
- No login required
- All resources owned by default user

**Security Model**
- Trusts local machine completely
- Full filesystem access
- No network isolation
- Agent credentials stored in user's home directory

**OAuth Flows**
- `opencode auth login` opens browser locally
- OAuth callbacks to `localhost:1455` (OpenAI) work directly
- No tunneling required

**Persistence**
- SQLite database in `~/.bob/bob.sqlite`
- Survives restarts
- Easy to backup (single file)
- No external dependencies

---

## Server Mode

### When to Use
- Team sharing Bob instance
- Remote development (VPS, cloud)
- CI/CD integration
- Production deployments

### Configuration

```bash
# .env (Server Mode)
BOB_MODE=server                           # Server mode
BOB_AUTH_ENABLED=true                     # Authentication required
DATABASE_URL=postgresql://...@neon.tech   # Neon Postgres
BOB_DATA_DIR=/var/lib/bob                 # Server data directory

# Authentication
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_CALLBACK_URL=https://bob.example.com/api/auth/github/callback
GITHUB_USER_ALLOWLIST=user1,user2,user3   # Optional: restrict access
SESSION_SECRET=xxx                         # Required: 32+ random chars

# OAuth Tunnel (for agent auth flows)
NGROK_AUTHTOKEN=xxx                        # Optional: for remote OAuth
NGROK_DOMAIN=bob-auth.ngrok-free.app      # Optional: stable callback URL
```

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Server Infrastructure                         │
│                                                                       │
│  ┌─────────────────┐                    ┌─────────────────────────┐  │
│  │   Load Balancer │                    │     Neon Postgres       │  │
│  │   (nginx/cdn)   │                    │   (Serverless DB)       │  │
│  └────────┬────────┘                    └───────────┬─────────────┘  │
│           │                                         │                 │
│  ┌────────┴────────────────────────────────────────┴──────────────┐  │
│  │                         Bob Server                              │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │  │
│  │  │  Frontend   │    │   Backend   │────│  Terminal Gateway   │ │  │
│  │  │  (Next.js)  │────│   (tRPC)    │    │   (WebSocket/PTY)   │ │  │
│  │  └─────────────┘    └─────────────┘    └─────────────────────┘ │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    /var/lib/bob/                                │  │
│  │  ├── users/                                                     │  │
│  │  │   ├── {userId-1}/                                           │  │
│  │  │   │   ├── worktrees/                                        │  │
│  │  │   │   │   ├── project-a-feature/                            │  │
│  │  │   │   │   └── project-b-bugfix/                             │  │
│  │  │   │   └── xdg/                    # User-scoped config      │  │
│  │  │   │       ├── config/opencode/                              │  │
│  │  │   │       └── data/opencode/                                │  │
│  │  │   └── {userId-2}/                                           │  │
│  │  │       └── ...                                                │  │
│  │  └── shared/                          # Shared resources        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │           Agent PTY Processes (Per-User Isolated)               │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                    │  │
│  │  │ User 1 Instances │  │ User 2 Instances │                    │  │
│  │  │ ┌──────┐┌──────┐ │  │ ┌──────┐┌──────┐ │                    │  │
│  │  │ │Claude││OpenC.│ │  │ │Gemini││Claude│ │                    │  │
│  │  │ └──────┘└──────┘ │  │ └──────┘└──────┘ │                    │  │
│  │  └──────────────────┘  └──────────────────┘                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌───────────────┐                                                   │
│  │ ngrok Tunnel  │ ←── OAuth callbacks for agent auth                │
│  │ (optional)    │                                                   │
│  └───────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘

        ▲                     ▲                     ▲
        │                     │                     │
   ┌────┴────┐          ┌────┴────┐          ┌────┴────┐
   │ User 1  │          │ User 2  │          │ User 3  │
   │ Browser │          │ Browser │          │   API   │
   └─────────┘          └─────────┘          └─────────┘
```

### Characteristics

**User Identity**
- Multiple authenticated users
- GitHub OAuth login required
- Each user has isolated resources
- Optional user allowlist

**Security Model**
- Strict tenant isolation
- Per-user filesystem partitioning
- User-scoped XDG directories for agent configs
- Rate limiting on API
- Audit logging

**OAuth Flows (Agent Authentication)**
When users run `opencode auth login`:
1. Server detects OAuth URL in terminal output
2. If ngrok enabled: Creates tunnel for callback
3. User authenticates in browser
4. Callback hits ngrok → Bob server → stores tokens
5. Tokens isolated per user in `xdg/data/opencode/`

**Persistence**
- Neon Postgres for metadata
- Filesystem for worktrees and configs
- Horizontal scaling possible
- Point-in-time recovery via Neon

---

## Feature Comparison

| Feature | Desktop | Server |
|---------|---------|--------|
| **Setup Time** | < 1 minute | 10-30 minutes |
| **External Dependencies** | None | Neon, OAuth app |
| **Offline Capable** | Yes | No |
| **Multi-User** | No | Yes |
| **API Keys** | Not needed | Supported |
| **Horizontal Scaling** | No | Yes |
| **Data Backup** | Manual file copy | Neon automated |
| **Security Hardening** | N/A | Required |
| **OAuth Tunnel** | Not needed | May be required |

---

## Security Considerations

### Desktop Mode

**Acceptable Risks**:
- Full filesystem access (it's the user's machine)
- No authentication (single user)
- SQLite without encryption (local only)

**Recommendations**:
- Don't expose ports to network
- Regular backups of `~/.bob/`

### Server Mode

**Required Hardening**:

1. **Authentication**
   ```bash
   BOB_AUTH_ENABLED=true
   SESSION_SECRET=<32+ random chars>
   ```

2. **HTTPS**
   - Always use TLS in production
   - Use reverse proxy (nginx, Caddy, Cloudflare)

3. **User Isolation**
   - User-scoped filesystem directories
   - User-scoped XDG environment for agents
   - Database queries filtered by `user_id`

4. **Rate Limiting**
   ```bash
   API_RATE_LIMIT=60          # Requests per minute
   API_KEY_RATE_LIMIT=120     # Higher for API keys
   ```

5. **Audit Logging**
   - Log all authentication events
   - Log instance start/stop
   - Log API key usage

6. **Dangerous Endpoints**
   ```bash
   # Disable in production
   BOB_ENABLE_DATABASE_ADMIN=false
   BOB_ENABLE_FILESYSTEM_BROWSE=false
   ```

---

## Mode Detection

Bob automatically detects mode based on configuration:

```typescript
function detectMode(): 'desktop' | 'server' {
  // Explicit mode setting takes precedence
  if (process.env.BOB_MODE) {
    return process.env.BOB_MODE as 'desktop' | 'server';
  }
  
  // Auth enabled implies server mode
  if (process.env.BOB_AUTH_ENABLED === 'true') {
    return 'server';
  }
  
  // Postgres URL implies server mode
  if (process.env.DATABASE_URL?.startsWith('postgresql://')) {
    return 'server';
  }
  
  // Default to desktop
  return 'desktop';
}
```

### Runtime Behavior

```typescript
const mode = detectMode();

if (mode === 'desktop') {
  // Skip authentication middleware
  // Use default-user for all operations
  // Store data in ~/.bob/
} else {
  // Require authentication
  // Derive userId from session
  // Store data in /var/lib/bob/users/{userId}/
  // Enable per-user isolation
}
```

---

## Migration Between Modes

### Desktop → Server

1. Export data from SQLite
2. Set up Neon Postgres database
3. Run migration script
4. Configure OAuth application
5. Deploy server infrastructure
6. Import data with user assignment

### Server → Desktop

1. Export user's data from Postgres
2. Create local SQLite database
3. Import data as default-user
4. Copy worktree directories
5. Reconfigure for desktop mode

---

## Environment Variables Reference

### Desktop Mode (Minimal)

```bash
# Optional overrides
BOB_MODE=desktop
BOB_DATA_DIR=~/.bob
DATABASE_URL=file:./bob.sqlite
PORT=3001
```

### Server Mode (Complete)

```bash
# Required
BOB_MODE=server
BOB_AUTH_ENABLED=true
DATABASE_URL=postgresql://user:pass@host.neon.tech/bobdb?sslmode=require
SESSION_SECRET=<generate with: openssl rand -base64 32>

# GitHub OAuth
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_CALLBACK_URL=https://bob.example.com/api/auth/github/callback

# Optional: User allowlist
GITHUB_USER_ALLOWLIST=user1,user2,user3

# Storage
BOB_DATA_DIR=/var/lib/bob

# API Configuration
PORT=3001
API_RATE_LIMIT=60
API_KEY_RATE_LIMIT=120

# Security
BOB_ENABLE_DATABASE_ADMIN=false
BOB_ENABLE_FILESYSTEM_BROWSE=false

# OAuth Tunnel (for agent auth)
NGROK_AUTHTOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NGROK_DOMAIN=bob-auth.ngrok-free.app

# Monitoring (optional)
SENTRY_DSN=https://xxx@sentry.io/xxx
POSTHOG_API_KEY=phc_xxxxxxxxxxxxx
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-12 | Initial deployment modes document |

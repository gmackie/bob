# VPS Deployment Guide

This guide explains how to deploy Bob to a VPS at `claude.gmac.io` using Docker.

## Prerequisites

- A VPS running Ubuntu 22.04 or later
- A domain pointed to your VPS (e.g., `claude.gmac.io`)
- SSH access to the VPS
- Git repository access

## Quick Start

### 1. Initial VPS Setup

SSH into your VPS and run the setup script:

```bash
# Download and run setup script
curl -fsSL https://raw.githubusercontent.com/your-org/bob/main/deploy/setup-vps.sh -o setup-vps.sh
chmod +x setup-vps.sh
sudo ./setup-vps.sh admin@youremail.com
```

This script will:
- Install Docker and Docker Compose
- Install and configure Nginx
- Obtain SSL certificates via Let's Encrypt
- Create the `bob` user
- Set up automatic certificate renewal

### 2. Clone the Repository

```bash
cd /opt/bob
sudo -u bob git clone https://github.com/your-org/bob.git .
```

### 3. Configure Environment

```bash
sudo -u bob cp .env.example .env
sudo -u bob nano .env
```

Edit the following values:

```bash
# Required settings
SESSION_SECRET=<generate-with-openssl-rand-base64-32>
FRONTEND_URL=https://claude.gmac.io

# Optional: GitHub OAuth (for user authentication)
USE_GITHUB_AUTH=true
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_CALLBACK_URL=https://claude.gmac.io/api/auth/github/callback
```

### 4. Build and Start

```bash
cd /opt/bob
sudo -u bob docker compose build
sudo -u bob docker compose up -d
```

### 5. Verify Deployment

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f

# Test health endpoint
curl https://claude.gmac.io/api/health
```

## Architecture

```
Internet → Nginx (SSL) → Docker (Bob) → AI Agents
                ↓
         Let's Encrypt
```

- **Nginx**: Handles SSL termination, proxies to Docker
- **Docker**: Runs Bob application on port 3001
- **Bob**: Manages AI agent instances and terminals

## File Locations

| Path | Description |
|------|-------------|
| `/opt/bob` | Application code |
| `/opt/bob/.env` | Environment configuration |
| `/var/log/nginx/bob_*.log` | Nginx access/error logs |
| `/etc/nginx/sites-available/bob` | Nginx configuration |
| `/etc/letsencrypt/live/claude.gmac.io/` | SSL certificates |

## Commands

### Application Management

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Restart
docker compose restart

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose build && docker compose up -d
```

### Updates

```bash
cd /opt/bob
git pull
docker compose build
docker compose up -d
```

### SSL Certificate

Certificates auto-renew via cron. To manually renew:

```bash
sudo certbot renew --dry-run  # Test
sudo certbot renew            # Actual renewal
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs bob

# Check if port is in use
sudo lsof -i :3001
```

### Nginx errors

```bash
# Test configuration
sudo nginx -t

# Reload after fixes
sudo systemctl reload nginx

# View logs
tail -f /var/log/nginx/bob_error.log
```

### SSL issues

```bash
# Check certificate status
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal
```

### Database issues

The SQLite database is stored in a Docker volume. To reset:

```bash
docker compose down
docker volume rm bob_bob-data
docker compose up -d
```

## Security Considerations

1. **Firewall**: Only ports 80, 443, and 22 should be exposed
2. **SSH**: Use key-based authentication, disable password login
3. **Updates**: Regularly update the VPS and Docker images
4. **Secrets**: Never commit `.env` to version control
5. **User Access**: Use `GITHUB_USER_ALLOWLIST` to restrict access

## GitHub OAuth Setup

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create new OAuth App:
   - **Application name**: Bob
   - **Homepage URL**: `https://claude.gmac.io`
   - **Authorization callback URL**: `https://claude.gmac.io/api/auth/github/callback`
3. Copy Client ID and Client Secret to `.env`

## Important Notes

### AI Agent CLIs

The Docker image includes several AI agent CLIs by default (Claude, Codex, Gemini, OpenCode). You can customize which agents are included by editing the Dockerfile.

**Install agents locally (outside Docker):**

```bash
# Install all agents
./scripts/install-agents.sh --all

# Install specific agents
./scripts/install-agents.sh --claude --opencode

# Check installation status
./scripts/install-agents.sh --status
```

**Customize Docker image agents:**

Edit the `Dockerfile` and uncomment/comment the agent installation lines:

```dockerfile
# Claude Code (enabled by default)
RUN npm install -g @anthropic-ai/claude-code

# Kiro CLI (disabled by default - uncomment to enable)
# RUN npm install -g kiro-cli
```

**Available agents:**
| Agent | Command | Installation |
|-------|---------|--------------|
| Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` |
| Codex | `codex` | `npm install -g @openai/codex` |
| Gemini | `gemini` | `npm install -g @google/gemini-cli` |
| OpenCode | `opencode` | `curl -fsSL https://opencode.ai/install \| bash` |
| Kiro | `kiro-cli` | `npm install -g kiro-cli` |
| Cursor Agent | `cursor-agent` | `npm install -g cursor-agent` |

### Terminal Sessions

WebSocket connections for terminal sessions require proper proxy configuration. The provided Nginx config handles this, but if you're using a different reverse proxy, ensure WebSocket upgrade headers are set.

### Persistent Data

All data is stored in Docker volumes:
- `bob-data`: Database and application state
- Mounted repos: Your git repositories

Back up these volumes regularly.

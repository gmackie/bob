# Multi-Agent Setup Guide

Bob now supports multiple AI coding assistants beyond Claude! You can use Codex, Gemini, Amazon Q, Cursor Agent, and OpenCode alongside or instead of Claude.

## Supported Agents

### 1. Claude (Default)
- **CLI**: `claude`
- **Installation**: `curl -fsSL https://claude.ai/install.sh | sh`
- **Authentication**: Automatic via browser
- **Best For**: General coding, complex problem solving

### 2. Codex
- **CLI**: `codex`
- **Installation**: Available through GitHub Copilot
- **Authentication**: GitHub account required
- **Best For**: Code completion, refactoring

### 3. Gemini
- **CLI**: `gemini`
- **Installation**: `npm install -g @google/gemini-cli`
- **Authentication**: Google Cloud account
- **Best For**: Multi-modal tasks, large context windows

### 4. Amazon Q
- **CLI**: `amazon-q`
- **Installation**: AWS Toolkit
- **Authentication**: AWS account
- **Best For**: AWS-specific development

### 5. Cursor Agent
- **CLI**: `cursor-agent`
- **Installation**: Cursor IDE
- **Authentication**: Cursor account
- **Best For**: IDE integration

### 6. OpenCode
- **CLI**: `opencode`
- **Installation**: Open source alternative
- **Authentication**: None required
- **Best For**: Privacy-focused development

## Quick Start

### 1. Install Your Preferred Agent

```bash
# Example: Install Gemini
npm install -g @google/gemini-cli

# Authenticate
gemini auth login
```

### 2. Start Bob

```bash
npm run dev:clean
```

### 3. Create Worktree with Agent

1. Click "+" next to any repository
2. Enter branch name
3. Select your agent from dropdown
4. Click "Create"

The selected agent will start automatically!

## Configuration

### Default Agent

Edit `backend/config/agents.json`:

```json
{
  "preferences": {
    "defaultAgent": "gemini",  // Change default here
    "fallbackOrder": ["gemini", "claude", "codex"]
  }
}
```

### User Preferences

Bob saves preferences in `~/.bob/config.json`:

```json
{
  "preferences": {
    "defaultAgent": "codex",
    "persistAgentSelection": true
  }
}
```

## Features by Agent

| Feature | Claude | Codex | Gemini | Amazon Q | Cursor | OpenCode |
|---------|--------|-------|--------|----------|--------|----------|
| Code Generation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Git Analysis | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| PR Generation | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Token Tracking | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Offline Mode | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## System Status Dashboard

View all agent statuses in the System Status tab:
- ✅ **Available**: Agent is installed and authenticated
- ⚠️ **Not Authenticated**: Agent needs login
- ❌ **Not Available**: Agent not installed

## Switching Agents

### For New Worktrees
Select the agent when creating the worktree.

### For Existing Worktrees
1. Stop current agent instance
2. Start new instance with different agent
3. Agent preference is saved automatically

## Docker Authentication

When running Bob in Docker, agents that require OAuth authentication (like Claude, Codex, and Gemini) need special handling since the container can't open a browser.

### Recommended Approach: Copy Auth Files

The easiest method is to authenticate locally first, then copy the auth files into the Docker container.

#### Claude Code

1. Authenticate locally:
   ```bash
   claude  # Follow the login prompts
   ```

2. Copy auth to Docker:
   ```bash
   docker cp ~/.claude bob:/home/bob/.claude
   ```

#### Codex (OpenAI)

Codex uses OAuth with a callback to `localhost:1455`. Authenticate locally first:

1. Authenticate locally:
   ```bash
   codex  # Select "Sign in with ChatGPT"
   ```

2. Copy auth to Docker:
   ```bash
   docker cp ~/.codex bob:/home/bob/.codex
   ```

#### Gemini

1. Authenticate locally:
   ```bash
   gemini auth login
   ```

2. Copy auth to Docker:
   ```bash
   docker cp ~/.gemini bob:/home/bob/.gemini
   ```

#### OpenCode

OpenCode is pre-configured to use Claude Opus 4.5 from Anthropic. To authenticate:

1. Authenticate locally using the `/connect` command within OpenCode
2. Copy auth to Docker:
   ```bash
   docker cp ~/.local/share/opencode/auth.json bob:/home/bob/.local/share/opencode/auth.json
   ```

#### Kiro

1. Authenticate locally:
   ```bash
   kiro-cli  # Follow the login prompts
   ```

2. Copy auth to Docker:
   ```bash
   docker cp ~/.kiro bob:/home/bob/.kiro
   ```

### Persistent Auth with Docker Volumes

The `docker-compose.yml` already mounts volumes for agent configs, so authentication persists across container restarts:

```yaml
volumes:
  - claude-config:/home/bob/.claude
  - gemini-config:/home/bob/.gemini
  - opencode-config:/home/bob/.opencode
  - kiro-config:/home/bob/.kiro
  - codex-config:/home/bob/.codex
```

After copying auth files once, they will persist in these volumes.

### OpenCode Configuration

OpenCode is pre-configured in Docker to use Claude Opus 4.5 from Anthropic. The default config is at `/home/bob/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "autoupdate": false
}
```

To change the default model, edit this file or mount a custom config.

## Troubleshooting

### Agent Not Available
- Verify CLI is installed: `which <agent-name>`
- Check PATH includes agent location
- Restart Bob after installation

### Authentication Issues
- Run agent auth command directly
- Check System Status for specific guidance
- Some agents require browser authentication
- For Docker, use the copy-auth-file approach described above

### Performance Issues
- Limit concurrent instances to 3-4
- Use lighter agents (OpenCode) for simple tasks
- Monitor memory usage in System Status

## API Usage

### Get Available Agents
```javascript
const agents = await api.getAgents();
```

### Start Instance with Agent
```javascript
await api.startInstance(worktreeId, 'gemini');
```

### Check Agent Status
```javascript
const status = await api.getSystemStatus();
console.log(status.agents);
```

## Best Practices

1. **Choose the Right Agent**: Different agents excel at different tasks
2. **Monitor Token Usage**: Some agents track usage and costs
3. **Use Fallbacks**: Configure fallback order for availability
4. **Test Compatibility**: Not all agents support all features

## Migration from Claude-Only

If upgrading from Claude-only Bob:

1. Your existing worktrees continue using Claude
2. New worktrees can use any agent
3. No data migration required
4. All Claude features remain available

## Contributing

To add a new agent:

1. Create adapter in `backend/src/agents/`
2. Extend `BaseAgentAdapter` class
3. Register in `AgentFactory`
4. Add to `AgentType` enum
5. Test with existing workflows

See `docs/planning/multi-agent-architecture.md` for details.
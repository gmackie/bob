# Agents Setup & Verification

This project supports multiple CLI agents via adapters. Use this guide to install, authenticate, and verify each one.

## Supported Agents
- Claude Code (`claude`)
- Codex CLI (`codex`)
- Gemini CLI (`gemini`)
- Kiro (`kiro-cli`)
- OpenCode (`opencode`)
- Cursor Agent (`cursor-agent`)

## Install & Authenticate

### Claude
- Install per vendor instructions, ensure `claude --version` works.
- Authentication: configure environment if required by your installation.

### Codex
- Install Codex CLI and ensure `codex --help` works.
- Default flags used by adapter:
  - `--sandbox workspace-write`
  - `--ask-for-approval on-failure`

### Gemini
- Install Gemini CLI and ensure `gemini --version` works.
- Default flags used by adapter:
  - `--sandbox`
  - `--approval-mode auto_edit`

### Kiro
- Install Kiro CLI and ensure `kiro-cli --version` works.
- Default flags used by adapter:
  - Interactive mode for TUI

### OpenCode
- Install OpenCode CLI and ensure `opencode --version` works.
- Authentication may be required depending on configuration.
- Default flags used by adapter:
  - `.` for interactive TUI mode
  - `run` for non-interactive mode

### Cursor Agent
- Install Cursor IDE which includes the cursor-agent CLI.
- Ensure `cursor-agent --version` works.
- Authentication via Cursor account.

## Verify Agents

Use the backend verification endpoint to test availability, authentication, and a short-lived PTY session per agent:

POST `/api/agents/verify`

Body (optional):
```
{
  "type": "codex",           // verify one agent (optional)
  "worktreeId": "...",       // use this worktree path if provided
  "timeoutMs": 2500           // optional settle timeout
}
```

Response example:
```
{
  "cwd": "/path/to/worktree",
  "results": [
    { "type": "claude", "ok": true,  "outputPreview": "..." },
    { "type": "codex",  "ok": true,  "outputPreview": "..." },
    { "type": "gemini", "ok": false, "reason": "not_authenticated" },
    { "type": "kiro",   "ok": true,  "outputPreview": "..." },
    { "type": "opencode", "ok": true, "outputPreview": "..." },
    { "type": "cursor-agent", "ok": false, "reason": "not_installed" }
  ]
}
```

## Interchangeability Notes
- Start/stop and terminals are agent-agnostic; the UI shows an agent badge (e.g., CODEX) for the running instance.
- Commit message generation uses the worktree’s active agent and falls back to Claude for unsupported interactive flows.
- If an agent is not present or authenticated, it will not be offered in the UI, and verification will report details.


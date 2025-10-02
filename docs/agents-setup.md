# Agents Setup & Verification

This project supports multiple CLI agents via adapters. Use this guide to install, authenticate, and verify each one.

## Supported Agents
- Claude Code (`claude`)
- Codex CLI (`codex`)
- Gemini CLI (`gemini`)
- Amazon Q (`q chat`)

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

### Amazon Q
- Install AWS CLI and Amazon Q CLI (`q`), ensure `q chat --help` works.
- Requires AWS credentials; see AWS docs for authentication.

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
    { "type": "gemini", "ok": false, "reason": "not_authenticated" }
  ]
}
```

## Interchangeability Notes
- Start/stop and terminals are agent-agnostic; the UI shows an agent badge (e.g., CODEX) for the running instance.
- Commit message generation uses the worktree’s active agent and falls back to Claude for unsupported interactive flows.
- If an agent is not present or authenticated, it will not be offered in the UI, and verification will report details.


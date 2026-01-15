# Agent Adapter Compatibility Contract

> **Document Version**: 1.0.0  
> **Last Updated**: 2026-01-12  
> **Status**: LOCKED - No adapter rewrites during migration

This document defines the contract that all agent adapters must follow. This contract is **frozen during migration** - existing adapters will not be modified.

---

## Contract Overview

Every AI agent in Bob (Claude, OpenCode, Kiro, Codex, Gemini, etc.) is wrapped by an adapter that implements a standard interface. This enables:

1. **Uniform lifecycle management** - All agents start, stop, and restart the same way
2. **Pluggable architecture** - New agents can be added without core changes
3. **PTY-based interaction** - Full terminal emulation for all agents
4. **Health monitoring** - Consistent availability and auth checks

---

## Interface Definition

```typescript
// From backend/src/types.ts
interface AgentAdapter {
  // Identity (readonly)
  readonly type: AgentType;      // e.g., 'opencode', 'claude'
  readonly name: string;         // Human-readable, e.g., 'OpenCode'
  readonly command: string;      // CLI command, e.g., 'opencode'

  // Availability
  checkAvailability(): Promise<{
    isAvailable: boolean;
    version?: string;
    statusMessage?: string;
  }>;

  // Authentication
  checkAuthentication(): Promise<{
    isAuthenticated: boolean;
    authenticationStatus?: string;
    statusMessage?: string;
  }>;

  // Process Management
  startProcess(worktreePath: string, port?: number): Promise<IPty>;
  
  // Configuration
  getSpawnArgs(options?: {
    interactive?: boolean;
    port?: number;
  }): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };

  // Optional
  parseOutput?(output: string): {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  } | null;
  
  cleanup?(process: IPty): Promise<void>;
}
```

---

## Required Methods

### 1. checkAvailability()

**Purpose**: Determine if the agent CLI is installed and functional.

**Contract**:
- MUST return within 10 seconds
- MUST NOT require authentication to succeed
- SHOULD extract version from `--version` output
- MUST catch and handle all errors gracefully

**Implementation Pattern**:
```typescript
async checkAvailability() {
  try {
    const result = await this.runCommand(['--version']);
    return {
      isAvailable: true,
      version: this.parseVersion(result.stdout),
      statusMessage: 'Available'
    };
  } catch (error) {
    return {
      isAvailable: false,
      statusMessage: error.message || 'Command not found'
    };
  }
}
```

### 2. checkAuthentication()

**Purpose**: Determine if the agent has valid credentials configured.

**Contract**:
- MUST return within 10 seconds
- MUST NOT prompt for credentials
- SHOULD use agent's status/whoami command
- MAY return `isAuthenticated: true` if no auth required

**Implementation Pattern**:
```typescript
// OpenCode example
async checkAuthentication() {
  try {
    const result = await this.runCommand(['auth', 'status']);
    const isAuthenticated = result.stdout.includes('authenticated') ||
                           result.stdout.includes('logged in');
    return {
      isAuthenticated,
      authenticationStatus: isAuthenticated ? 'Logged in' : 'Not authenticated',
      statusMessage: result.stdout.split('\n')[0]
    };
  } catch (error) {
    return {
      isAuthenticated: false,
      statusMessage: 'Unable to check auth status'
    };
  }
}
```

### 3. getSpawnArgs()

**Purpose**: Return the command, arguments, and environment for spawning the agent.

**Contract**:
- MUST return synchronously (no async)
- MUST include all required arguments
- MAY return custom environment variables
- Environment is MERGED with `process.env`, not replaced

**Implementation Pattern**:
```typescript
getSpawnArgs(options?: { interactive?: boolean; port?: number }) {
  const args: string[] = [];
  
  if (options?.interactive) {
    args.push('.');  // OpenCode interactive mode
  }
  
  return {
    command: this.command,
    args,
    env: {
      // Agent-specific environment
      OPENCODE_TELEMETRY: 'false'
    }
  };
}
```

### 4. startProcess()

**Purpose**: Start the agent as a PTY process in the specified worktree.

**Contract**:
- MUST spawn using `node-pty` (not child_process)
- MUST set `cwd` to `worktreePath`
- MUST merge `getSpawnArgs().env` with `process.env`
- MUST resolve when agent is ready (or after timeout fallback)
- MUST reject if agent fails to start
- SHOULD detect readiness via output patterns

**Base Implementation** (inherited by all adapters):
```typescript
async startProcess(worktreePath: string, port?: number): Promise<IPty> {
  const { args, env } = this.getSpawnArgs({ interactive: true, port });
  const resolvedCommand = getAgentCommand(this.type);

  const ptyProcess = spawnPty(resolvedCommand, args, {
    cwd: worktreePath,
    cols: 120,
    rows: 40,
    env: {
      ...process.env,
      ...env
    }
  });

  // Wait for readiness or timeout
  return new Promise((resolve, reject) => {
    // ... readiness detection logic
  });
}
```

---

## Optional Methods

### parseOutput()

**Purpose**: Extract usage metrics from agent output.

**Contract**:
- MAY return `null` if no metrics found
- SHOULD look for JSON usage data in output
- MUST NOT throw exceptions

**Implementation Pattern**:
```typescript
parseOutput(output: string) {
  // Look for JSON usage data
  const jsonMatch = output.match(/\{[^}]*"tokens"[^}]*\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]);
      return {
        inputTokens: data.input_tokens || data.prompt_tokens,
        outputTokens: data.output_tokens || data.completion_tokens,
        cost: data.cost
      };
    } catch {
      return null;
    }
  }
  return null;
}
```

### cleanup()

**Purpose**: Perform agent-specific cleanup before process termination.

**Contract**:
- MAY perform graceful shutdown commands
- MUST call `process.kill()` if not already terminated
- MUST NOT throw exceptions

**Implementation Pattern**:
```typescript
async cleanup(process: IPty) {
  // Send exit command if agent supports it
  process.write('/exit\r');
  
  // Wait briefly for graceful shutdown
  await new Promise(r => setTimeout(r, 500));
  
  // Force kill if still running
  if (process && typeof process.kill === 'function') {
    process.kill();
  }
}
```

---

## Environment Injection

### Current Behavior (Desktop Mode)

Adapters receive the server's `process.env`:
```typescript
const ptyProcess = spawnPty(command, args, {
  cwd: worktreePath,
  env: {
    ...process.env,        // Server's environment
    ...adapterEnv          // Adapter-specific additions
  }
});
```

### Future Behavior (Multi-User Server Mode)

Adapters will receive user-scoped environment:
```typescript
const ptyProcess = spawnPty(command, args, {
  cwd: worktreePath,
  env: {
    ...process.env,                              // Server base env
    HOME: `/var/lib/bob/users/${userId}`,        // User home
    XDG_CONFIG_HOME: `~/.bob/users/${userId}/.config`,
    XDG_DATA_HOME: `~/.bob/users/${userId}/.local/share`,
    XDG_STATE_HOME: `~/.bob/users/${userId}/.local/state`,
    BOB_USER_ID: userId,                         // Identifier
    BOB_INSTANCE_ID: instanceId,                 // Correlation
    ...adapterEnv                                // Adapter additions
  }
});
```

**Migration Note**: This change is handled in the `AgentService` layer, NOT in adapters. Adapters continue to return their `env` object; the service handles user scoping.

---

## Adding New Adapters

### Step 1: Define Type

```typescript
// backend/src/types.ts
export type AgentType = 'claude' | 'opencode' | 'kiro' | 'codex' | 'gemini' | 'NEW_AGENT';
```

### Step 2: Create Adapter File

```typescript
// backend/src/agents/newagent-adapter.ts
import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';

export class NewAgentAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'newagent';
  readonly name = 'New Agent';
  readonly command = 'newagent';

  getSpawnArgs(options?: { interactive?: boolean; port?: number }) {
    return {
      command: this.command,
      args: options?.interactive ? ['start'] : ['run'],
      env: {}
    };
  }

  // Override if agent has authentication
  async checkAuthentication() {
    const result = await this.runCommand(['auth', 'status']);
    return {
      isAuthenticated: result.code === 0,
      statusMessage: result.stdout
    };
  }

  // Override for custom readiness detection
  protected isAgentReady(data: string, fullOutput: string): boolean {
    return fullOutput.includes('Ready') || super.isAgentReady(data, fullOutput);
  }
}
```

### Step 3: Register in Factory

```typescript
// backend/src/agents/agent-factory.ts
import { NewAgentAdapter } from './newagent-adapter.js';

class AgentFactory {
  private adapters: Map<AgentType, AgentAdapter>;

  constructor() {
    this.adapters = new Map();
    this.registerAdapters();
  }

  private registerAdapters() {
    this.adapters.set('claude', new ClaudeAdapter());
    this.adapters.set('opencode', new OpenCodeAdapter());
    this.adapters.set('newagent', new NewAgentAdapter());  // Add here
    // ...
  }
}
```

### Step 4: Add Command Resolution

```typescript
// backend/src/utils/agentPaths.ts
const agentCommands: Record<AgentType, string> = {
  claude: 'claude',
  opencode: 'opencode',
  newagent: 'newagent',  // Add here
  // ...
};
```

---

## Testing Adapters

### Minimum Test Cases

1. **Availability Check**
   ```typescript
   const adapter = new NewAgentAdapter();
   const result = await adapter.checkAvailability();
   expect(result.isAvailable).toBeDefined();
   ```

2. **Auth Check**
   ```typescript
   const result = await adapter.checkAuthentication();
   expect(result.isAuthenticated).toBeDefined();
   ```

3. **Spawn Args**
   ```typescript
   const { command, args, env } = adapter.getSpawnArgs({ interactive: true });
   expect(command).toBe('newagent');
   expect(args).toContain('start');
   ```

4. **Process Start** (integration test)
   ```typescript
   const pty = await adapter.startProcess('/tmp/test-worktree');
   expect(pty.pid).toBeGreaterThan(0);
   pty.kill();
   ```

---

## Existing Adapters Reference

| Adapter | Type | Command | Auth Check | Notes |
|---------|------|---------|------------|-------|
| `ClaudeAdapter` | `claude` | `claude` | `--print` | Has usage parsing |
| `OpenCodeAdapter` | `opencode` | `opencode` | `auth status` | TUI mode with `.` |
| `KiroAdapter` | `kiro` | `kiro-cli` | None | Simple CLI |
| `CodexAdapter` | `codex` | `codex` | None | GitHub Codex |
| `GeminiAdapter` | `gemini` | `gemini` | None | Google Gemini |
| `CursorAgentAdapter` | `cursor-agent` | `cursor-agent` | None | Cursor IDE agent |

---

## Migration Guarantee

During the migration phases (1-7):

1. **NO changes** to the `AgentAdapter` interface
2. **NO changes** to existing adapter implementations
3. **NO changes** to adapter registration mechanism
4. **ONLY changes** to the environment injection in `AgentService`
5. **ONLY additions** of new wrapper functionality (auth orchestration)

Adapters are **frozen** until migration is complete and verified.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-12 | Initial adapter contract document |

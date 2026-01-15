# Bob Architecture Invariants

> **Document Version**: 1.0.0  
> **Last Updated**: 2026-01-12  
> **Status**: LOCKED - These invariants MUST NOT be violated during migration

This document defines the core architectural invariants that must be preserved throughout all migration phases. These are non-negotiable constraints that ensure system stability and backward compatibility.

---

## 1. Worktrees Are Source of Truth

### Invariant
**Git worktrees on the filesystem are the canonical source of truth for project state.**

### Rationale
- Worktrees contain actual code, git history, and project files
- Database records are metadata pointers to filesystem state
- If database and filesystem disagree, filesystem wins

### Implications
- Never delete filesystem worktrees based solely on database state
- Always verify filesystem existence before database operations
- Orphan database records can be cleaned up; orphan filesystem state cannot be recreated
- Sync operations flow: `filesystem → database`, not the reverse

### Migration Guarantee
```
During migration:
- Existing worktree folders in ~/.bob/ WILL NOT be moved or deleted
- Worktree paths remain stable across database migrations
- Users can continue working in worktrees during migration windows
```

---

## 2. Agent Adapters Remain PTY-Based

### Invariant
**All AI agent interactions use pseudo-terminal (PTY) sessions via node-pty.**

### Rationale
- PTY provides true terminal emulation required by CLI agents
- Supports interactive prompts, escape sequences, and TUI interfaces
- Enables real-time bidirectional communication
- Compatible with all supported agents (Claude, Kiro, Codex, Gemini, OpenCode)

### Adapter Contract
Every agent adapter MUST implement:
```typescript
interface AgentAdapter {
  // Identity
  readonly type: AgentType;
  readonly name: string;
  readonly command: string;

  // Lifecycle
  checkAvailability(): Promise<{ isAvailable: boolean; version?: string }>;
  checkAuthentication(): Promise<{ isAuthenticated: boolean }>;
  startProcess(worktreePath: string, port?: number): Promise<IPty>;
  
  // Configuration
  getSpawnArgs(options?: SpawnOptions): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  
  // Optional
  parseOutput?(output: string): UsageMetrics | null;
  cleanup?(process: IPty): Promise<void>;
}
```

### Migration Guarantee
```
During migration:
- NO adapter rewrites - existing adapters work unchanged
- New plumbing (auth, config) wraps adapters, doesn't modify them
- PTY spawn mechanism remains identical
- WebSocket terminal streaming unchanged
```

---

## 3. Existing Worktree Folders Preserved

### Invariant
**All existing worktree folders in `~/.bob/` are preserved during migration.**

### Current Structure
```
~/.bob/
├── worktrees/
│   ├── {repo-name}-{branch-name}/    # Worktree directories
│   │   ├── .git                       # Git worktree link
│   │   └── [project files]
│   └── ...
└── bob.sqlite                         # Database (current)
```

### Future Structure (Multi-User Server Mode)
```
~/.bob/
├── users/
│   └── {userId}/
│       ├── worktrees/
│       │   └── {repo-name}-{branch-name}/
│       └── xdg/                       # User-scoped config
│           ├── config/
│           ├── data/
│           └── state/
├── worktrees/                         # Legacy (migrated on access)
└── bob.sqlite                         # Database (legacy, read-only after migration)
```

### Migration Strategy
1. **No proactive move** - existing worktrees stay in place
2. **Lazy migration** - worktrees moved to user scope on first access post-migration
3. **Symlink fallback** - if lazy migration fails, create symlinks
4. **Audit trail** - log all worktree migrations for debugging

### Migration Guarantee
```
During migration:
- ~/.bob/worktrees/* paths remain valid
- Active terminal sessions continue uninterrupted
- No worktree data loss under any circumstances
- Rollback restores original paths if migration fails
```

---

## 4. REST API Remains Available (Compatibility Mode)

### Invariant
**Existing REST API endpoints remain functional throughout migration and beyond.**

### Current API Surface
```
# Repositories
GET    /api/repositories
POST   /api/repositories
DELETE /api/repositories/:id

# Worktrees
POST   /api/repositories/:id/worktrees
DELETE /api/repositories/:repoId/worktrees/:worktreeId

# Instances
GET    /api/instances
POST   /api/instances/start/:worktreeId
POST   /api/instances/stop/:instanceId
POST   /api/instances/restart/:instanceId

# Terminal Sessions
POST   /api/instances/:id/terminal
POST   /api/instances/:id/terminal/directory
DELETE /api/instances/sessions/:sessionId

# Git Operations
GET    /api/git/:worktreeId/diff
POST   /api/git/:worktreeId/analyze
POST   /api/git/:worktreeId/commit
POST   /api/git/:worktreeId/pr

# System
GET    /api/system-status
GET    /api/agents
```

### Compatibility Strategy
1. **Phase 4-6**: tRPC procedures implemented alongside REST
2. **Phase 7**: REST endpoints become thin wrappers calling tRPC
3. **Post-Migration**: REST remains available indefinitely
4. **Deprecation**: Only with 6-month notice and major version bump

### Versioning
```
/api/v1/...    # Current API (aliased to /api/...)
/api/v2/...    # Future breaking changes (if any)
/api/...       # Always points to latest stable (v1 initially)
```

### Migration Guarantee
```
During migration:
- All existing REST endpoints continue to work
- Response shapes remain identical
- No authentication changes until explicitly enabled
- Frontend can migrate to tRPC gradually
```

---

## 5. Database Schema Backward Compatibility

### Invariant
**Database migrations are additive and reversible.**

### Rules
1. **No column drops** without deprecation period
2. **No type changes** that lose data (e.g., TEXT → INTEGER)
3. **New columns** must have defaults or be nullable
4. **Foreign keys** added only with data backfill
5. **Unique constraints** changed only with duplicate resolution

### Migration Pattern
```sql
-- CORRECT: Additive migration
ALTER TABLE repositories ADD COLUMN user_id TEXT;
UPDATE repositories SET user_id = 'default-user' WHERE user_id IS NULL;

-- INCORRECT: Breaking migration
ALTER TABLE repositories DROP COLUMN path;  -- NEVER
```

### Rollback Capability
Every migration MUST have a corresponding down migration:
```typescript
export const up = async (db: Database) => {
  await db.run('ALTER TABLE repositories ADD COLUMN user_id TEXT');
};

export const down = async (db: Database) => {
  // SQLite doesn't support DROP COLUMN, so we recreate
  await db.run('CREATE TABLE repositories_backup AS SELECT id, name, path, ... FROM repositories');
  await db.run('DROP TABLE repositories');
  await db.run('ALTER TABLE repositories_backup RENAME TO repositories');
};
```

---

## 6. Process Isolation

### Invariant
**Each agent instance runs in an isolated process with its own PTY.**

### Implications
- One crash doesn't affect other instances
- Resource limits can be applied per-instance
- Authentication state is per-process (via environment)
- No shared mutable state between instances

### Environment Isolation (Multi-User)
```typescript
// Each instance gets isolated environment
const env = {
  ...process.env,
  HOME: `/home/bob/users/${userId}`,
  XDG_CONFIG_HOME: `/home/bob/users/${userId}/.config`,
  XDG_DATA_HOME: `/home/bob/users/${userId}/.local/share`,
  XDG_STATE_HOME: `/home/bob/users/${userId}/.local/state`,
  BOB_USER_ID: userId,
  BOB_INSTANCE_ID: instanceId,
};
```

---

## Violation Reporting

If any migration or code change would violate these invariants:

1. **STOP** - Do not proceed with the change
2. **DOCUMENT** - Record the proposed change and which invariant it violates
3. **ESCALATE** - Raise for architectural review
4. **ALTERNATIVES** - Propose alternative approaches that preserve invariants

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-12 | Initial invariants document |

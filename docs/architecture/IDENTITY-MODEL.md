# Bob Identity Model

> **Document Version**: 1.0.0  
> **Last Updated**: 2026-01-12  
> **Status**: DESIGN - Approved for implementation

This document defines the identity and authorization model for Bob, supporting both single-user desktop and multi-user server deployments.

---

## Overview

Bob's identity model is designed around these principles:
1. **Progressive complexity** - Single-user mode requires zero auth configuration
2. **Tenant isolation** - Multi-user mode provides strict resource separation
3. **Future-proof** - Organization/workspace support can be added later without schema changes

---

## Core Entities

### User

The primary identity entity representing a human user.

```typescript
interface User {
  // Identity
  id: string;                    // UUID, stable across migrations
  
  // Profile (from OAuth provider)
  email: string;                 // Primary email, unique
  displayName: string;           // Human-readable name
  avatarUrl?: string;            // Profile image URL
  
  // Provider linkage
  provider: 'github' | 'google' | 'email';
  providerAccountId: string;     // Provider's user ID
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  
  // Flags
  isAdmin: boolean;              // System administrator
  isActive: boolean;             // Account enabled
}
```

### Special Users

| User | ID | Purpose |
|------|-----|---------|
| `system` | `00000000-0000-0000-0000-000000000000` | System-generated resources |
| `default-user` | `00000000-0000-0000-0000-000000000001` | Single-user desktop mode |

---

## Resource Ownership

### All Resources Have Owners

Every resource in Bob is owned by exactly one user:

```typescript
// Base interface for all owned resources
interface OwnedResource {
  id: string;
  userId: string;  // Owner's user ID (FK to users.id)
  createdAt: Date;
  updatedAt: Date;
}

// Resources that implement OwnedResource
interface Repository extends OwnedResource { /* ... */ }
interface Worktree extends OwnedResource { /* ... */ }
interface AgentInstance extends OwnedResource { /* ... */ }
interface DiffComment extends OwnedResource { /* ... */ }
interface ApiKey extends OwnedResource { /* ... */ }
```

### Ownership Rules

| Resource | Owner | Inheritance |
|----------|-------|-------------|
| `Repository` | User who added it | - |
| `Worktree` | User who created it | - |
| `AgentInstance` | User who started it | From worktree on start |
| `DiffComment` | User who wrote it | - |
| `ApiKey` | User who generated it | - |
| `TokenUsage` | System | Linked to instance owner |

### Single-User Mode

In single-user desktop mode (default):
- All resources belong to `default-user`
- No authentication required
- User ID is implicit in all operations

### Multi-User Mode

In multi-user server mode:
- Resources belong to the authenticated user
- Strict tenant isolation enforced at query level
- Cross-tenant access denied by default

---

## Authorization Model

### Permission Levels

```typescript
type Permission = 
  | 'read'      // View resource
  | 'write'     // Modify resource
  | 'delete'    // Remove resource
  | 'admin';    // Manage resource + grant permissions
```

### Resource Access Control

```typescript
interface AccessPolicy {
  // Default: owner has all permissions
  owner: Permission[];  // Always: ['read', 'write', 'delete', 'admin']
  
  // Future: organization members
  orgMembers?: Permission[];  // e.g., ['read']
  
  // Future: explicit sharing
  sharedWith?: Array<{
    userId: string;
    permissions: Permission[];
  }>;
}
```

### Current Implementation (v1)

For v1, access control is simple:
- **Owner** can do anything with their resources
- **Non-owner** cannot access resources at all
- **Admin** can access all resources (for debugging)

```typescript
function canAccess(user: User, resource: OwnedResource, permission: Permission): boolean {
  // Admins can do anything
  if (user.isAdmin) return true;
  
  // Owners can do anything with their resources
  if (resource.userId === user.id) return true;
  
  // Everyone else: denied
  return false;
}
```

---

## Authentication Strategies

### 1. GitHub OAuth (Primary)

```typescript
interface GitHubAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowlist?: string[];  // Optional: restrict to specific usernames
}
```

**Flow**:
1. User clicks "Login with GitHub"
2. Redirect to GitHub OAuth
3. GitHub redirects back with code
4. Exchange code for tokens
5. Fetch user profile
6. Create/update local user record
7. Issue session

### 2. API Key (Programmatic)

```typescript
interface ApiKey extends OwnedResource {
  name: string;           // Human-readable name
  keyHash: string;        // bcrypt hash of the key
  prefix: string;         // First 8 chars for identification (e.g., "bob_key_")
  scopes: string[];       // Allowed operations
  expiresAt?: Date;       // Optional expiration
  lastUsedAt?: Date;      // For auditing
  rateLimit: number;      // Requests per minute
}
```

**Flow**:
1. User generates API key in UI
2. Key shown once, stored hashed
3. Client sends `Authorization: Bearer bob_key_xxxxx`
4. Server validates hash, checks scopes
5. Request proceeds with key owner's identity

### 3. Session Cookies (Browser)

```typescript
interface Session {
  id: string;             // Session ID (UUID)
  userId: string;         // FK to users
  createdAt: Date;
  expiresAt: Date;        // Rolling expiration
  userAgent: string;      // For audit
  ipAddress: string;      // For audit
}
```

---

## Query Scoping

### Service Layer Pattern

All data access is scoped by user:

```typescript
class RepositoryService {
  constructor(private db: Database) {}
  
  // All queries include userId filter
  async getAll(userId: string): Promise<Repository[]> {
    return this.db.all(
      'SELECT * FROM repositories WHERE user_id = ?',
      [userId]
    );
  }
  
  async getById(userId: string, id: string): Promise<Repository | null> {
    return this.db.get(
      'SELECT * FROM repositories WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }
  
  async create(userId: string, data: CreateRepositoryData): Promise<Repository> {
    const id = generateUUID();
    await this.db.run(
      'INSERT INTO repositories (id, user_id, name, path, ...) VALUES (?, ?, ?, ?, ...)',
      [id, userId, data.name, data.path, ...]
    );
    return this.getById(userId, id);
  }
}
```

### Route Handler Pattern

```typescript
// All routes extract userId from authenticated session
router.get('/api/repositories', requireAuth, async (req, res) => {
  const userId = req.user.id;  // From auth middleware
  const repositories = await repositoryService.getAll(userId);
  res.json(repositories);
});

router.get('/api/repositories/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const repository = await repositoryService.getById(userId, req.params.id);
  
  if (!repository) {
    return res.status(404).json({ error: 'Repository not found' });
  }
  
  res.json(repository);
});
```

---

## Future: Organizations & Workspaces

The identity model is designed to support future expansion:

### Organizations (Future)

```typescript
interface Organization {
  id: string;
  name: string;
  slug: string;           // URL-safe identifier
  ownerId: string;        // Primary admin
  createdAt: Date;
}

interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: Date;
}
```

### Workspaces (Future)

```typescript
interface Workspace {
  id: string;
  name: string;
  organizationId?: string;  // null = personal workspace
  userId: string;           // Owner
  createdAt: Date;
}

// Resources can be assigned to workspaces
interface Repository extends OwnedResource {
  workspaceId?: string;  // null = personal
}
```

### Migration Path

1. Add `organization_id` and `workspace_id` columns (nullable)
2. Existing resources remain in personal space
3. Users can create orgs and move resources
4. No breaking changes to existing queries

---

## Database Schema

### Users Table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT,
  UNIQUE(provider, provider_account_id)
);

-- Default user for single-user mode
INSERT INTO users (id, email, display_name, provider, provider_account_id, is_admin)
VALUES ('00000000-0000-0000-0000-000000000001', 'default@localhost', 'Default User', 'local', 'default', 1);
```

### Sessions Table

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

### API Keys Table

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL,  -- JSON array
  rate_limit INTEGER NOT NULL DEFAULT 60,
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
```

---

## Configuration

### Environment Variables

```bash
# Authentication mode
BOB_AUTH_ENABLED=false           # Set to true for multi-user mode

# GitHub OAuth (required when auth enabled)
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_CALLBACK_URL=http://localhost:3001/api/auth/github/callback

# User allowlist (optional, comma-separated GitHub usernames)
GITHUB_USER_ALLOWLIST=user1,user2

# Session configuration
SESSION_SECRET=xxx               # Required: random 32+ char string
SESSION_MAX_AGE=604800000        # 7 days in milliseconds

# API key configuration
API_KEY_PREFIX=bob_key_
API_KEY_DEFAULT_RATE_LIMIT=60    # Requests per minute
```

---

## Migration Checklist

- [ ] Add `user_id` column to all resource tables
- [ ] Backfill existing resources with `default-user` ID
- [ ] Add foreign key constraints
- [ ] Update unique constraints to include `user_id`
- [ ] Update all service methods to accept `userId` parameter
- [ ] Update all route handlers to extract `userId` from session
- [ ] Add `requireAuth` middleware to protected routes
- [ ] Create API key generation UI
- [ ] Create admin user management UI

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-12 | Initial identity model design |

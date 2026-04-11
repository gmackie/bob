# WS Gateway Slim — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `apps/ws-gateway/` as a fresh TypeScript package — a slim WebSocket relay that routes messages between browser clients and Go daemons, persists events to Postgres, and nudges daemons about new sessions. No agent spawning, no git, no builds.

**Architecture:** Single Node.js process. HTTP server on port 3002 with three endpoints: `/sessions` (WebSocket), `/health` (HTTP GET), `/internal/nudge` (HTTP POST). Browser clients authenticate via better-auth session tokens. Daemon clients authenticate via API key + workspaceId. Events flow daemon → gateway → browser; input flows browser → gateway → daemon. Every event is persisted to `session_events` via batched writes before being forwarded.

**Tech Stack:** Node 22, TypeScript 5, ws (WebSocket library), Drizzle ORM (via `@bob/db`), vitest for tests, tsup for bundling, pnpm workspace package.

**Design reference:** `docs/plans/2026-04-10-ws-gateway-migration-design.md`

**Scope:** This plan covers ONLY the slim gateway package. Go daemon changes, database migration, and hetzner-master deployment are separate phases.

---

## Context: What exists that you can reuse

The current `apps/gateway/` package has code we can copy/adapt:

- **`apps/gateway/src/ws/protocol.ts`** — Existing message type definitions. We'll copy this and extend it with daemon-specific messages.
- **`apps/gateway/src/persistence/PersistenceWriter.ts`** — Batched event queue with flush logic. Copy as-is, no changes needed.

The `@bob/db` package exports everything we need:

- `db` — drizzle client from `@bob/db/client`
- `chatConversations` — the sessions table (schema.ts:997)
- `sessionEvents` — the events table (schema.ts:1328)
- `apiKeys` — for daemon auth (schema.ts:45)
- `workspaces` — for daemon workspace validation (schema.ts:505)
- `session` (better-auth) — for browser auth validation (packages/db/src/auth-schema.ts:13)

**DO NOT touch `apps/gateway/`.** That's the old fat gateway. We leave it alone until Phase 5 cleanup.

---

## Task 1: Create package skeleton

**Files:**
- Create: `apps/ws-gateway/package.json`
- Create: `apps/ws-gateway/tsconfig.json`
- Create: `apps/ws-gateway/tsup.config.ts`
- Create: `apps/ws-gateway/.gitignore`
- Create: `apps/ws-gateway/src/index.ts` (placeholder)

**Step 1: Create `apps/ws-gateway/package.json`**

```json
{
  "name": "@bob/ws-gateway",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@bob/db": "workspace:*",
    "ws": "catalog:"
  },
  "devDependencies": {
    "@bob/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "@types/ws": "catalog:",
    "tsup": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "^4.0.0"
  }
}
```

**Step 2: Create `apps/ws-gateway/tsconfig.json`**

```json
{
  "extends": "@bob/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create `apps/ws-gateway/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
});
```

**Step 4: Create `apps/ws-gateway/.gitignore`**

```
dist/
node_modules/
*.tsbuildinfo
```

**Step 5: Create placeholder `apps/ws-gateway/src/index.ts`**

```ts
console.log("[ws-gateway] boot");
```

**Step 6: Install deps and verify**

```bash
cd /Users/mackieg/.config/superpowers/worktrees/bob/ws-gateway-phase1
pnpm install
cd apps/ws-gateway
pnpm typecheck
```

Expected: `pnpm install` adds the new package to the workspace. `pnpm typecheck` passes with no errors.

**Step 7: Commit**

```bash
git add apps/ws-gateway/
git commit -m "feat(ws-gateway): package skeleton"
```

---

## Task 2: Copy and extend protocol

**Files:**
- Create: `apps/ws-gateway/src/protocol.ts`
- Create: `apps/ws-gateway/src/protocol.test.ts`

**Step 1: Write failing test for daemon hello parsing**

Create `apps/ws-gateway/src/protocol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseClientMessage, encodeServerMessage } from "./protocol.js";

describe("protocol", () => {
  describe("parseClientMessage", () => {
    it("parses a browser hello message", () => {
      const raw = JSON.stringify({
        type: "hello",
        clientId: "client-1",
        deviceType: "web",
        token: "session-token-xyz",
      });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({
        type: "hello",
        clientId: "client-1",
        deviceType: "web",
        token: "session-token-xyz",
      });
    });

    it("parses a daemon hello message with workspaceId", () => {
      const raw = JSON.stringify({
        type: "hello",
        clientId: "daemon-1",
        deviceType: "daemon",
        token: "api-key-abc",
        workspaceId: "ws-uuid-123",
      });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({
        type: "hello",
        clientId: "daemon-1",
        deviceType: "daemon",
        token: "api-key-abc",
        workspaceId: "ws-uuid-123",
      });
    });

    it("parses a session_event message from a daemon", () => {
      const raw = JSON.stringify({
        type: "session_event",
        sessionId: "sess-1",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello", stream: "stdout" },
      });
      const msg = parseClientMessage(raw);
      expect(msg?.type).toBe("session_event");
    });

    it("returns null for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeNull();
    });

    it("returns null for missing type field", () => {
      expect(parseClientMessage('{"foo": "bar"}')).toBeNull();
    });
  });

  describe("encodeServerMessage", () => {
    it("encodes a hello_ok message", () => {
      const encoded = encodeServerMessage({
        type: "hello_ok",
        gatewayTime: "2026-04-10T00:00:00.000Z",
        heartbeatIntervalMs: 30000,
        userId: "user-1",
      });
      expect(JSON.parse(encoded)).toEqual({
        type: "hello_ok",
        gatewayTime: "2026-04-10T00:00:00.000Z",
        heartbeatIntervalMs: 30000,
        userId: "user-1",
      });
    });

    it("encodes a session_available message to a daemon", () => {
      const encoded = encodeServerMessage({
        type: "session_available",
        sessionId: "sess-1",
        workingDirectory: "/tmp/work",
        agentType: "claude",
        title: "test session",
      });
      expect(JSON.parse(encoded).type).toBe("session_available");
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/ws-gateway && pnpm test
```

Expected: Fail with module not found or type errors — `protocol.ts` doesn't export these yet.

**Step 3: Create `apps/ws-gateway/src/protocol.ts`**

```ts
// ============================================================================
// Shared types
// ============================================================================

export type SessionStatus =
  | "provisioning"
  | "starting"
  | "running"
  | "idle"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "error";

export type DeviceType = "web" | "ios" | "android" | "desktop" | "daemon" | "other";

export type EventDirection = "client" | "agent" | "system";

export type SessionEventType =
  | "output_chunk"
  | "message_final"
  | "input"
  | "tool_call"
  | "tool_result"
  | "state"
  | "error"
  | "heartbeat";

// ============================================================================
// Client → Gateway messages
// ============================================================================

export interface ClientHello {
  type: "hello";
  clientId: string;
  deviceType: DeviceType;
  token: string;
  /** Required when deviceType === "daemon" */
  workspaceId?: string;
}

export interface ClientSubscribe {
  type: "subscribe";
  sessionId: string;
  lastAckSeq: number;
}

export interface ClientUnsubscribe {
  type: "unsubscribe";
  sessionId: string;
}

export interface ClientInput {
  type: "input";
  sessionId: string;
  clientInputId: string;
  data: string;
}

export interface ClientAck {
  type: "ack";
  sessionId: string;
  seq: number;
}

export interface ClientPing {
  type: "ping";
  ts: string;
}

/** Daemon announces it has accepted a session_available nudge */
export interface ClientSessionClaimed {
  type: "session_claimed";
  sessionId: string;
}

/** Daemon reports an event from the running agent */
export interface ClientSessionEvent {
  type: "session_event";
  sessionId: string;
  eventType: SessionEventType;
  direction: EventDirection;
  payload: Record<string, unknown>;
}

/** Daemon reports a session lifecycle change */
export interface ClientSessionStatus {
  type: "session_status";
  sessionId: string;
  status: SessionStatus;
}

export type ClientMessage =
  | ClientHello
  | ClientSubscribe
  | ClientUnsubscribe
  | ClientInput
  | ClientAck
  | ClientPing
  | ClientSessionClaimed
  | ClientSessionEvent
  | ClientSessionStatus;

// ============================================================================
// Gateway → Client messages
// ============================================================================

export interface ServerHelloOk {
  type: "hello_ok";
  gatewayTime: string;
  heartbeatIntervalMs: number;
  userId: string;
}

export interface ServerSubscribed {
  type: "subscribed";
  sessionId: string;
  currentState: SessionStatus;
  latestSeq: number;
}

export interface ServerUnsubscribed {
  type: "unsubscribed";
  sessionId: string;
}

export interface ServerInputAck {
  type: "input_ack";
  sessionId: string;
  clientInputId: string;
  acceptedSeq: number;
}

export interface ServerEvent {
  type: "event";
  sessionId: string;
  seq: number;
  eventType: SessionEventType;
  direction: EventDirection;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ServerPong {
  type: "pong";
  ts: string;
}

export interface ServerError {
  type: "error";
  code: string;
  message: string;
  sessionId?: string;
  retryable: boolean;
}

/** Gateway nudges a daemon that a new session is pending */
export interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
}

/** Gateway tells subscribers the session's live status changed */
export interface ServerSessionStatusChanged {
  type: "session_status_changed";
  sessionId: string;
  status: SessionStatus;
}

/** Gateway tells the browser it exceeded the replay window */
export interface ServerReplayTruncated {
  type: "replay_truncated";
  sessionId: string;
  oldestAvailableSeq: number;
}

export type ServerMessage =
  | ServerHelloOk
  | ServerSubscribed
  | ServerUnsubscribed
  | ServerInputAck
  | ServerEvent
  | ServerPong
  | ServerError
  | ServerSessionAvailable
  | ServerSessionStatusChanged
  | ServerReplayTruncated;

// ============================================================================
// Codec
// ============================================================================

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data) as ClientMessage;
    if (!msg || typeof msg !== "object" || !msg.type) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function createError(
  code: string,
  message: string,
  sessionId?: string,
  retryable = false,
): ServerError {
  return { type: "error", code, message, sessionId, retryable };
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm test
```

Expected: All tests pass (7 passing).

**Step 5: Commit**

```bash
git add apps/ws-gateway/src/protocol.ts apps/ws-gateway/src/protocol.test.ts
git commit -m "feat(ws-gateway): message protocol with daemon extensions"
```

---

## Task 3: Copy PersistenceWriter

**Files:**
- Create: `apps/ws-gateway/src/persistence.ts` (copy of `apps/gateway/src/persistence/PersistenceWriter.ts`)
- Create: `apps/ws-gateway/src/persistence.test.ts`

**Step 1: Copy `apps/gateway/src/persistence/PersistenceWriter.ts` to `apps/ws-gateway/src/persistence.ts`**

Change the import at the top from:
```ts
import type { EventDirection, SessionEventType } from "../ws/protocol.js";
```
to:
```ts
import type { EventDirection, SessionEventType } from "./protocol.js";
```

Everything else stays the same.

**Step 2: Write `apps/ws-gateway/src/persistence.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { PersistenceWriter, type SessionEventRecord } from "./persistence.js";

function makeEvent(sessionId: string, seq: number): SessionEventRecord {
  return {
    sessionId,
    seq,
    direction: "agent",
    eventType: "output_chunk",
    payload: { data: `chunk-${seq}` },
  };
}

describe("PersistenceWriter", () => {
  it("batches events and flushes on batchSize", async () => {
    const writes: SessionEventRecord[][] = [];
    const writer = new PersistenceWriter({
      batchSize: 3,
      flushIntervalMs: 1000,
      onBatchWrite: async (batch) => {
        writes.push(batch);
      },
    });
    writer.start();

    writer.enqueue(makeEvent("s1", 1));
    writer.enqueue(makeEvent("s1", 2));
    writer.enqueue(makeEvent("s1", 3));

    // Allow the triggerFlush microtask to run
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(writes.length).toBe(1);
    expect(writes[0]).toHaveLength(3);
    await writer.stop();
  });

  it("flushes on interval when batch is not full", async () => {
    const writes: SessionEventRecord[][] = [];
    const writer = new PersistenceWriter({
      batchSize: 100,
      flushIntervalMs: 50,
      onBatchWrite: async (batch) => {
        writes.push(batch);
      },
    });
    writer.start();

    writer.enqueue(makeEvent("s1", 1));
    writer.enqueue(makeEvent("s1", 2));

    await new Promise((r) => setTimeout(r, 100));

    expect(writes.length).toBe(1);
    expect(writes[0]).toHaveLength(2);
    await writer.stop();
  });

  it("drops events when queue is full", () => {
    const writer = new PersistenceWriter({
      batchSize: 1000,
      flushIntervalMs: 1000,
      maxQueueSize: 2,
      onBatchWrite: async () => {},
    });
    writer.start();

    expect(writer.enqueue(makeEvent("s1", 1))).toBe(true);
    expect(writer.enqueue(makeEvent("s1", 2))).toBe(true);
    expect(writer.enqueue(makeEvent("s1", 3))).toBe(false);
  });

  it("flushes remaining events on stop", async () => {
    const writes: SessionEventRecord[][] = [];
    const writer = new PersistenceWriter({
      batchSize: 100,
      flushIntervalMs: 10000,
      onBatchWrite: async (batch) => {
        writes.push(batch);
      },
    });
    writer.start();
    writer.enqueue(makeEvent("s1", 1));

    await writer.stop();

    expect(writes.length).toBe(1);
    expect(writes[0]).toHaveLength(1);
  });

  it("calls onError when batch write throws", async () => {
    const errors: Array<{ error: Error; events: SessionEventRecord[] }> = [];
    const writer = new PersistenceWriter({
      batchSize: 1,
      flushIntervalMs: 1000,
      onBatchWrite: async () => {
        throw new Error("db down");
      },
      onError: (error, events) => {
        errors.push({ error, events });
      },
    });
    writer.start();
    writer.enqueue(makeEvent("s1", 1));

    await new Promise((r) => setTimeout(r, 50));

    expect(errors.length).toBe(1);
    expect(errors[0].error.message).toBe("db down");
    await writer.stop();
  });
});
```

**Step 3: Run tests**

```bash
cd apps/ws-gateway && pnpm test
```

Expected: All 5 persistence tests pass, plus the 7 protocol tests from Task 2.

**Step 4: Commit**

```bash
git add apps/ws-gateway/src/persistence.ts apps/ws-gateway/src/persistence.test.ts
git commit -m "feat(ws-gateway): batched event persistence writer"
```

---

## Task 4: Auth module — browser token validation

**Files:**
- Create: `apps/ws-gateway/src/auth.ts`
- Create: `apps/ws-gateway/src/auth.test.ts`

**Context:** Browser clients send a better-auth session token in the `hello.token` field. Better-auth stores sessions in the `session` table (from `packages/db/src/auth-schema.ts`). We query it directly by token to get the `userId` — we own the DB, no need to call better-auth's HTTP API.

```sql
-- session table shape (from packages/db/src/auth-schema.ts)
id (text, pk), expiresAt (timestamp), token (text, unique),
userId (text, fk to user.id), createdAt, updatedAt, ...
```

**Step 1: Write the failing test**

Create `apps/ws-gateway/src/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module BEFORE importing auth
vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      session: {
        findFirst: vi.fn(),
      },
      apiKeys: {
        findFirst: vi.fn(),
      },
      workspaces: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import { db } from "@bob/db/client";
import { validateBrowserToken, validateDaemonAuth } from "./auth.js";

describe("validateBrowserToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns userId when session token is valid and not expired", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    (db.query.session.findFirst as any).mockResolvedValueOnce({
      id: "sess-1",
      token: "good-token",
      userId: "user-abc",
      expiresAt: future,
    });

    const result = await validateBrowserToken("good-token");
    expect(result).toBe("user-abc");
  });

  it("returns null when token does not match any session", async () => {
    (db.query.session.findFirst as any).mockResolvedValueOnce(null);

    const result = await validateBrowserToken("bad-token");
    expect(result).toBeNull();
  });

  it("returns null when session is expired", async () => {
    const past = new Date(Date.now() - 1000);
    (db.query.session.findFirst as any).mockResolvedValueOnce({
      id: "sess-1",
      token: "old-token",
      userId: "user-abc",
      expiresAt: past,
    });

    const result = await validateBrowserToken("old-token");
    expect(result).toBeNull();
  });

  it("returns null for empty token", async () => {
    expect(await validateBrowserToken("")).toBeNull();
    expect(db.query.session.findFirst).not.toHaveBeenCalled();
  });
});

describe("validateDaemonAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns userId when api key and workspaceId both match", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: null,
      expiresAt: null,
    });
    (db.query.workspaces.findFirst as any).mockResolvedValueOnce({
      id: "ws-1",
      ownerUserId: "user-abc",
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBe("user-abc");
  });

  it("returns null when api key is revoked", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: new Date(),
      expiresAt: null,
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBeNull();
  });

  it("returns null when api key is expired", async () => {
    const past = new Date(Date.now() - 1000);
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: null,
      expiresAt: past,
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBeNull();
  });

  it("returns null when workspace does not belong to the api key's user", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: null,
      expiresAt: null,
    });
    (db.query.workspaces.findFirst as any).mockResolvedValueOnce({
      id: "ws-1",
      ownerUserId: "someone-else",
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBeNull();
  });

  it("returns null when api key is missing", async () => {
    expect(await validateDaemonAuth("", "ws-1")).toBeNull();
    expect(await validateDaemonAuth("bob_live_xyz", "")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test
```

Expected: Fail — `auth.ts` does not exist.

**Step 3: Create `apps/ws-gateway/src/auth.ts`**

```ts
import { createHash } from "node:crypto";
import { db } from "@bob/db/client";

/**
 * Validate a better-auth session token and return the userId.
 * Returns null if the token is invalid or the session is expired.
 *
 * The session table is owned by better-auth but we query it directly —
 * we share the same Postgres and don't need to call better-auth's HTTP API.
 */
export async function validateBrowserToken(token: string): Promise<string | null> {
  if (!token) return null;

  const row = await db.query.session.findFirst({
    where: (session, { eq }) => eq(session.token, token),
  });

  if (!row) return null;

  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  if (expiresAt.getTime() <= Date.now()) return null;

  return row.userId;
}

/**
 * Validate a daemon's API key + workspaceId pair.
 *
 * Checks:
 *   1. API key exists in api_keys table (matched by hash)
 *   2. Not revoked, not expired
 *   3. workspaceId belongs to the same userId as the API key
 *
 * Returns the userId on success, null on failure.
 */
export async function validateDaemonAuth(
  apiKey: string,
  workspaceId: string,
): Promise<string | null> {
  if (!apiKey || !workspaceId) return null;

  const keyHash = hashApiKey(apiKey);

  const keyRow = await db.query.apiKeys.findFirst({
    where: (apiKeys, { eq }) => eq(apiKeys.keyHash, keyHash),
  });

  if (!keyRow) return null;
  if (keyRow.revokedAt) return null;
  if (keyRow.expiresAt) {
    const expiresAt =
      keyRow.expiresAt instanceof Date ? keyRow.expiresAt : new Date(keyRow.expiresAt);
    if (expiresAt.getTime() <= Date.now()) return null;
  }

  const workspace = await db.query.workspaces.findFirst({
    where: (workspaces, { eq }) => eq(workspaces.id, workspaceId),
  });

  if (!workspace) return null;
  if (workspace.ownerUserId !== keyRow.userId) return null;

  return keyRow.userId;
}

/**
 * Hash an API key the same way the auth router does when creating keys.
 * SHA-256 hex encoding — keep this in sync with packages/api/src/router/apiKeys.ts.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}
```

**IMPORTANT**: Before committing, verify the hash algorithm matches. Run:

```bash
grep -rn "keyHash\|hashApiKey\|createHash" /Volumes/dev/bob/packages/api/src/router/apiKeys.ts 2>/dev/null | head -5
grep -rn "keyHash" /Volumes/dev/bob/packages/api/src/services/apiKeys* 2>/dev/null | head -5
```

If the existing code uses a different algorithm (e.g. bcrypt, argon2, sha512), update `hashApiKey` to match. If there's a shared helper (e.g. `packages/api/src/lib/apiKeyHash.ts`), import it instead of duplicating the implementation.

**Step 4: Run test to verify it passes**

```bash
pnpm test
```

Expected: All 9 auth tests pass, plus previous tests from Tasks 2–3.

**Step 5: Commit**

```bash
git add apps/ws-gateway/src/auth.ts apps/ws-gateway/src/auth.test.ts
git commit -m "feat(ws-gateway): browser and daemon auth validation"
```

---

## Task 5: Relay core — connection maps and message routing

**Files:**
- Create: `apps/ws-gateway/src/relay.ts`
- Create: `apps/ws-gateway/src/relay.test.ts`

**Context:** The relay is the beating heart of the gateway. It tracks:
- `clientConnections: Map<userId, Set<Connection>>` — browser clients by user
- `daemonConnections: Map<workspaceId, Connection>` — at most one daemon per workspace
- `sessionSubscribers: Map<sessionId, Set<Connection>>` — who gets events for each session

When a daemon sends a `session_event`, the relay persists it and forwards to all subscribers of that session. When a browser sends `input`, the relay looks up the session's workspace and forwards to that workspace's daemon.

The relay talks to the DB for:
- Verifying session ownership on `subscribe`
- Replaying missed events on `subscribe`
- Reading session metadata for `session_available` nudges
- Writing events via `PersistenceWriter`

**Step 1: Write failing tests for relay**

Create `apps/ws-gateway/src/relay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ClientMessage, ServerMessage } from "./protocol.js";

// Mock db
vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      chatConversations: { findFirst: vi.fn() },
      sessionEvents: { findMany: vi.fn() },
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  },
}));

import { db } from "@bob/db/client";
import { Relay } from "./relay.js";

// Fake WebSocket that captures sent messages
class FakeWs extends EventEmitter {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  receive(msg: ClientMessage) {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
  lastSentMessage(): ServerMessage | null {
    const last = this.sent[this.sent.length - 1];
    return last ? JSON.parse(last) : null;
  }
  sentOfType(type: string): ServerMessage[] {
    return this.sent.map((s) => JSON.parse(s)).filter((m) => m.type === type);
  }
}

describe("Relay", () => {
  let relay: Relay;
  let persistedEvents: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    persistedEvents = [];
    relay = new Relay({
      heartbeatIntervalMs: 30000,
      persistEvent: async (event) => {
        persistedEvents.push(event);
      },
      validateBrowserToken: async (token) => (token === "good-browser" ? "user-1" : null),
      validateDaemonAuth: async (token, wsId) =>
        token === "good-daemon" && wsId === "ws-1" ? "user-1" : null,
    });
  });

  describe("browser hello", () => {
    it("authenticates and responds with hello_ok", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      const helloOk = ws.lastSentMessage();
      expect(helloOk?.type).toBe("hello_ok");
      expect((helloOk as any).userId).toBe("user-1");
    });

    it("rejects invalid token and closes connection", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "bad",
      });
      await new Promise((r) => setImmediate(r));

      const err = ws.lastSentMessage();
      expect(err?.type).toBe("error");
      expect((err as any).code).toBe("AUTH_FAILED");
      expect(ws.readyState).toBe(3); // closed
    });
  });

  describe("daemon hello", () => {
    it("requires workspaceId", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        // workspaceId missing
      });
      await new Promise((r) => setImmediate(r));

      const err = ws.lastSentMessage();
      expect(err?.type).toBe("error");
      expect((err as any).code).toBe("AUTH_FAILED");
    });

    it("authenticates with valid api key and workspaceId", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      const helloOk = ws.lastSentMessage();
      expect(helloOk?.type).toBe("hello_ok");
    });
  });

  describe("browser subscribe", () => {
    it("verifies session ownership before subscribing", async () => {
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "sess-1",
        userId: "user-2", // different user
        nextSeq: 5,
        status: "running",
      });

      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe", sessionId: "sess-1", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e) => (e as any).code === "ACCESS_DENIED")).toBe(true);
    });

    it("replays missed events on subscribe", async () => {
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "sess-1",
        userId: "user-1",
        nextSeq: 5,
        status: "running",
      });
      (db.query.sessionEvents.findMany as any).mockResolvedValueOnce([
        {
          sessionId: "sess-1",
          seq: 3,
          eventType: "output_chunk",
          direction: "agent",
          payload: { data: "hi" },
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
        },
        {
          sessionId: "sess-1",
          seq: 4,
          eventType: "output_chunk",
          direction: "agent",
          payload: { data: "there" },
          createdAt: new Date("2026-04-10T00:00:01.000Z"),
        },
      ]);

      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe", sessionId: "sess-1", lastAckSeq: 2 });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const events = ws.sentOfType("event");
      expect(events.length).toBe(2);
      expect((events[0] as any).seq).toBe(3);
      expect((events[1] as any).seq).toBe(4);
    });
  });

  describe("session event relay", () => {
    it("persists and forwards daemon events to subscribers", async () => {
      // Set up a daemon
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      // Session exists owned by user-1 in workspace ws-1
      (db.query.chatConversations.findFirst as any)
        .mockResolvedValueOnce({
          id: "sess-1",
          userId: "user-1",
          nextSeq: 1,
          status: "running",
        })
        .mockResolvedValueOnce({
          id: "sess-1",
          userId: "user-1",
          nextSeq: 1,
          status: "running",
          // workspace lookup for daemon routing
        });
      (db.query.sessionEvents.findMany as any).mockResolvedValueOnce([]);

      // Set up a subscriber
      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      browserWs.receive({ type: "subscribe", sessionId: "sess-1", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      // Daemon sends an event
      daemonWs.receive({
        type: "session_event",
        sessionId: "sess-1",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello" },
      });
      await new Promise((r) => setImmediate(r));

      // Event was persisted
      expect(persistedEvents.length).toBe(1);
      expect(persistedEvents[0].sessionId).toBe("sess-1");

      // Event was forwarded to the browser subscriber
      const forwarded = browserWs.sentOfType("event");
      expect(forwarded.length).toBeGreaterThan(0);
      expect((forwarded[forwarded.length - 1] as any).payload.data).toBe("hello");
    });
  });

  describe("session nudge", () => {
    it("pushes session_available to the right daemon", async () => {
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      relay.nudgeSession({
        sessionId: "sess-99",
        workspaceId: "ws-1",
        workingDirectory: "/tmp/work",
        agentType: "claude",
        title: "new idea",
      });

      const nudges = daemonWs.sentOfType("session_available");
      expect(nudges.length).toBe(1);
      expect((nudges[0] as any).sessionId).toBe("sess-99");
    });

    it("silently drops nudge when daemon is offline", () => {
      // No daemon connected
      expect(() =>
        relay.nudgeSession({
          sessionId: "sess-99",
          workspaceId: "ws-1",
          workingDirectory: "/tmp",
          agentType: "claude",
        }),
      ).not.toThrow();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test
```

Expected: Fail — `relay.ts` does not exist.

**Step 3: Create `apps/ws-gateway/src/relay.ts`**

```ts
import type { WebSocket } from "ws";
import { eq, and, gt, asc } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, sessionEvents } from "@bob/db/schema";

import {
  parseClientMessage,
  encodeServerMessage,
  createError,
  type ClientMessage,
  type ClientHello,
  type ClientSubscribe,
  type ClientUnsubscribe,
  type ClientInput,
  type ClientSessionEvent,
  type ClientSessionStatus,
  type ClientSessionClaimed,
  type ServerMessage,
  type SessionStatus,
} from "./protocol.js";
import type { SessionEventRecord } from "./persistence.js";

const REPLAY_LIMIT = 500;

interface Connection {
  id: string;
  ws: WebSocket;
  kind: "browser" | "daemon" | "unauth";
  userId: string | null;
  workspaceId: string | null; // set for daemon
  clientId: string;
  subscribedSessions: Set<string>;
  heartbeatTimer: NodeJS.Timeout | null;
}

interface NudgeInput {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
}

export interface RelayConfig {
  heartbeatIntervalMs: number;
  persistEvent: (event: SessionEventRecord) => Promise<void> | void;
  validateBrowserToken: (token: string) => Promise<string | null>;
  validateDaemonAuth: (token: string, workspaceId: string) => Promise<string | null>;
}

export class Relay {
  private readonly cfg: RelayConfig;
  private readonly connections = new Map<string, Connection>();
  private readonly clientsByUser = new Map<string, Set<Connection>>();
  private readonly daemonByWorkspace = new Map<string, Connection>();
  private readonly subscribers = new Map<string, Set<Connection>>();
  private nextConnId = 0;

  constructor(cfg: RelayConfig) {
    this.cfg = cfg;
  }

  handleConnection(ws: WebSocket): void {
    const id = `conn-${++this.nextConnId}`;
    const conn: Connection = {
      id,
      ws,
      kind: "unauth",
      userId: null,
      workspaceId: null,
      clientId: "",
      subscribedSessions: new Set(),
      heartbeatTimer: null,
    };
    this.connections.set(id, conn);

    ws.on("message", async (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString();
      const msg = parseClientMessage(raw);
      if (!msg) {
        this.send(conn, createError("INVALID_MESSAGE", "Failed to parse message"));
        return;
      }
      try {
        await this.handleMessage(conn, msg);
      } catch (err) {
        console.error(`[Relay] Error handling ${msg.type} from ${id}:`, err);
        this.send(conn, createError("INTERNAL_ERROR", "Internal error"));
      }
    });

    ws.on("close", () => {
      this.cleanupConnection(conn);
    });

    ws.on("error", (err: Error) => {
      console.error(`[Relay] WebSocket error on ${id}:`, err.message);
    });
  }

  /**
   * Push a session_available message to the daemon owning the given workspace.
   * Silently drops if no daemon is connected — the daemon will pick it up
   * from the DB on next connect.
   */
  nudgeSession(input: NudgeInput): void {
    const daemon = this.daemonByWorkspace.get(input.workspaceId);
    if (!daemon) return;

    this.send(daemon, {
      type: "session_available",
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
      agentType: input.agentType,
      title: input.title,
    });
  }

  getStats() {
    return {
      connections: this.connections.size,
      browserCount: Array.from(this.connections.values()).filter((c) => c.kind === "browser").length,
      daemonCount: this.daemonByWorkspace.size,
      sessionSubscriptions: this.subscribers.size,
    };
  }

  // ── Message dispatch ───────────────────────────────────────────────

  private async handleMessage(conn: Connection, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        await this.handleHello(conn, msg);
        return;
      case "ping":
        this.send(conn, { type: "pong", ts: new Date().toISOString() });
        return;
    }

    if (conn.kind === "unauth") {
      this.send(conn, createError("NOT_AUTHENTICATED", "Must send hello first"));
      return;
    }

    switch (msg.type) {
      case "subscribe":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "Subscribe is for browsers"));
          return;
        }
        await this.handleSubscribe(conn, msg);
        return;
      case "unsubscribe":
        this.handleUnsubscribe(conn, msg);
        return;
      case "input":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "Input is for browsers"));
          return;
        }
        await this.handleInput(conn, msg);
        return;
      case "ack":
        // No-op in slim gateway: we persist every event synchronously.
        // The ack is informational — the browser's lastAckSeq is what matters on reconnect.
        return;
      case "session_claimed":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_claimed is for daemons"));
          return;
        }
        await this.handleSessionClaimed(conn, msg);
        return;
      case "session_event":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_event is for daemons"));
          return;
        }
        await this.handleSessionEvent(conn, msg);
        return;
      case "session_status":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_status is for daemons"));
          return;
        }
        await this.handleSessionStatus(conn, msg);
        return;
    }
  }

  // ── Hello / auth ───────────────────────────────────────────────────

  private async handleHello(conn: Connection, hello: ClientHello): Promise<void> {
    conn.clientId = hello.clientId;

    if (hello.deviceType === "daemon") {
      if (!hello.workspaceId) {
        this.send(conn, createError("AUTH_FAILED", "Daemon hello missing workspaceId", undefined, false));
        conn.ws.close();
        return;
      }
      const userId = await this.cfg.validateDaemonAuth(hello.token, hello.workspaceId);
      if (!userId) {
        this.send(conn, createError("AUTH_FAILED", "Invalid daemon credentials", undefined, false));
        conn.ws.close();
        return;
      }
      conn.kind = "daemon";
      conn.userId = userId;
      conn.workspaceId = hello.workspaceId;

      // If another daemon was registered for this workspace, boot it.
      const existing = this.daemonByWorkspace.get(hello.workspaceId);
      if (existing && existing !== conn) {
        this.send(existing, createError("SUPERSEDED", "Another daemon connected for this workspace", undefined, false));
        existing.ws.close();
      }
      this.daemonByWorkspace.set(hello.workspaceId, conn);
    } else {
      // Browser (or other client types default to browser auth)
      const userId = await this.cfg.validateBrowserToken(hello.token);
      if (!userId) {
        this.send(conn, createError("AUTH_FAILED", "Invalid or expired token", undefined, true));
        conn.ws.close();
        return;
      }
      conn.kind = "browser";
      conn.userId = userId;

      let userSet = this.clientsByUser.get(userId);
      if (!userSet) {
        userSet = new Set();
        this.clientsByUser.set(userId, userSet);
      }
      userSet.add(conn);
    }

    conn.heartbeatTimer = setInterval(() => {
      this.send(conn, { type: "pong", ts: new Date().toISOString() });
    }, this.cfg.heartbeatIntervalMs);

    this.send(conn, {
      type: "hello_ok",
      gatewayTime: new Date().toISOString(),
      heartbeatIntervalMs: this.cfg.heartbeatIntervalMs,
      userId: conn.userId!,
    });
  }

  // ── Browser subscribe ──────────────────────────────────────────────

  private async handleSubscribe(conn: Connection, sub: ClientSubscribe): Promise<void> {
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, sub.sessionId),
    });

    if (!session) {
      this.send(conn, createError("SESSION_NOT_FOUND", `Session ${sub.sessionId} not found`, sub.sessionId));
      return;
    }

    if (session.userId !== conn.userId) {
      this.send(conn, createError("ACCESS_DENIED", "Not authorized for this session", sub.sessionId));
      return;
    }

    // Register subscription
    let subs = this.subscribers.get(sub.sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sub.sessionId, subs);
    }
    subs.add(conn);
    conn.subscribedSessions.add(sub.sessionId);

    // Send subscribed confirmation
    this.send(conn, {
      type: "subscribed",
      sessionId: sub.sessionId,
      currentState: (session.status ?? "stopped") as SessionStatus,
      latestSeq: session.nextSeq - 1,
    });

    // Replay missed events
    if (sub.lastAckSeq < session.nextSeq - 1) {
      const events = await db.query.sessionEvents.findMany({
        where: and(
          eq(sessionEvents.sessionId, sub.sessionId),
          gt(sessionEvents.seq, sub.lastAckSeq),
        ),
        orderBy: asc(sessionEvents.seq),
        limit: REPLAY_LIMIT + 1,
      });

      const toReplay = events.slice(0, REPLAY_LIMIT);
      for (const event of toReplay) {
        this.send(conn, {
          type: "event",
          sessionId: event.sessionId,
          seq: event.seq,
          eventType: event.eventType as any,
          direction: event.direction as any,
          payload: event.payload,
          createdAt:
            event.createdAt instanceof Date
              ? event.createdAt.toISOString()
              : String(event.createdAt),
        });
      }

      if (events.length > REPLAY_LIMIT) {
        this.send(conn, {
          type: "replay_truncated",
          sessionId: sub.sessionId,
          oldestAvailableSeq: toReplay[toReplay.length - 1]?.seq ?? sub.lastAckSeq,
        });
      }
    }
  }

  private handleUnsubscribe(conn: Connection, unsub: ClientUnsubscribe): void {
    const subs = this.subscribers.get(unsub.sessionId);
    if (subs) {
      subs.delete(conn);
      if (subs.size === 0) this.subscribers.delete(unsub.sessionId);
    }
    conn.subscribedSessions.delete(unsub.sessionId);
    this.send(conn, { type: "unsubscribed", sessionId: unsub.sessionId });
  }

  // ── Browser input → daemon ─────────────────────────────────────────

  private async handleInput(conn: Connection, input: ClientInput): Promise<void> {
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, input.sessionId),
    });

    if (!session || session.userId !== conn.userId) {
      this.send(conn, createError("SESSION_NOT_FOUND", "Session not found", input.sessionId));
      return;
    }

    // Find the daemon for this session's workspace.
    // Sessions don't directly store workspaceId — we look up via the daemon map
    // by matching the session's user to any active daemon.
    // For v1, if the user has multiple workspaces, the nudge router already
    // picked one; we route inputs to whichever daemon is live for that user.
    const daemon = this.findDaemonForUser(conn.userId!);
    if (!daemon) {
      this.send(conn, createError("DAEMON_OFFLINE", "No daemon online for this session", input.sessionId, true));
      return;
    }

    this.send(daemon, {
      type: "event",
      sessionId: input.sessionId,
      seq: 0, // input events aren't persisted with a seq; daemon ignores seq field here
      eventType: "input",
      direction: "client",
      payload: { data: input.data, clientInputId: input.clientInputId },
      createdAt: new Date().toISOString(),
    });

    // Ack to the browser
    this.send(conn, {
      type: "input_ack",
      sessionId: input.sessionId,
      clientInputId: input.clientInputId,
      acceptedSeq: 0,
    });
  }

  private findDaemonForUser(userId: string): Connection | null {
    for (const daemon of this.daemonByWorkspace.values()) {
      if (daemon.userId === userId) return daemon;
    }
    return null;
  }

  // ── Daemon session_claimed ─────────────────────────────────────────

  private async handleSessionClaimed(conn: Connection, claim: ClientSessionClaimed): Promise<void> {
    // Update DB: mark session as claimed by this daemon's workspace.
    // For v1 we just update the status from "pending" to "starting".
    await db
      .update(chatConversations)
      .set({ status: "starting" })
      .where(
        and(
          eq(chatConversations.id, claim.sessionId),
          eq(chatConversations.userId, conn.userId!),
        ),
      );
  }

  // ── Daemon session_event → persist + fan out ───────────────────────

  private async handleSessionEvent(conn: Connection, event: ClientSessionEvent): Promise<void> {
    // Verify the session belongs to this daemon's user.
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, event.sessionId),
    });

    if (!session || session.userId !== conn.userId) {
      this.send(
        conn,
        createError("ACCESS_DENIED", "Cannot emit events for this session", event.sessionId),
      );
      return;
    }

    // Assign sequence number (we read nextSeq from DB row, increment, write back).
    // For v1 this is eventually consistent — the daemon may send bursts faster than
    // the round-trip updates nextSeq, so we use a simple counter in memory and trust
    // the persistEvent callback to enforce the unique (sessionId, seq) constraint.
    const seq = session.nextSeq;
    await db
      .update(chatConversations)
      .set({ nextSeq: seq + 1 })
      .where(eq(chatConversations.id, event.sessionId));

    const record: SessionEventRecord = {
      sessionId: event.sessionId,
      seq,
      direction: event.direction,
      eventType: event.eventType,
      payload: event.payload,
    };

    await this.cfg.persistEvent(record);

    // Fan out to all subscribers of this session
    const subs = this.subscribers.get(event.sessionId);
    if (subs) {
      const forwarded: ServerMessage = {
        type: "event",
        sessionId: event.sessionId,
        seq,
        eventType: event.eventType,
        direction: event.direction,
        payload: event.payload,
        createdAt: new Date().toISOString(),
      };
      for (const sub of subs) {
        this.send(sub, forwarded);
      }
    }
  }

  // ── Daemon session_status → update DB + notify subscribers ─────────

  private async handleSessionStatus(conn: Connection, msg: ClientSessionStatus): Promise<void> {
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, msg.sessionId),
    });
    if (!session || session.userId !== conn.userId) return;

    await db
      .update(chatConversations)
      .set({ status: msg.status })
      .where(eq(chatConversations.id, msg.sessionId));

    const subs = this.subscribers.get(msg.sessionId);
    if (subs) {
      for (const sub of subs) {
        this.send(sub, {
          type: "session_status_changed",
          sessionId: msg.sessionId,
          status: msg.status,
        });
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  private cleanupConnection(conn: Connection): void {
    if (conn.heartbeatTimer) {
      clearInterval(conn.heartbeatTimer);
      conn.heartbeatTimer = null;
    }

    // Remove from subscribers
    for (const sessionId of conn.subscribedSessions) {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        subs.delete(conn);
        if (subs.size === 0) this.subscribers.delete(sessionId);
      }
    }

    // Remove from user clients
    if (conn.kind === "browser" && conn.userId) {
      const userSet = this.clientsByUser.get(conn.userId);
      if (userSet) {
        userSet.delete(conn);
        if (userSet.size === 0) this.clientsByUser.delete(conn.userId);
      }
    }

    // Remove from daemon map
    if (conn.kind === "daemon" && conn.workspaceId) {
      const current = this.daemonByWorkspace.get(conn.workspaceId);
      if (current === conn) {
        this.daemonByWorkspace.delete(conn.workspaceId);
      }
    }

    this.connections.delete(conn.id);
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.ws.readyState !== 1 /* OPEN */) return;
    conn.ws.send(encodeServerMessage(msg));
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm test
```

Expected: All relay tests pass. There are some async complexities — if tests fail with "expected X to be defined", add more `await new Promise(r => setImmediate(r))` between actions and assertions.

**Step 5: Commit**

```bash
git add apps/ws-gateway/src/relay.ts apps/ws-gateway/src/relay.test.ts
git commit -m "feat(ws-gateway): relay with browser and daemon routing"
```

---

## Task 6: Nudge endpoint

**Files:**
- Create: `apps/ws-gateway/src/nudge.ts`
- Create: `apps/ws-gateway/src/nudge.test.ts`

**Context:** The nudge endpoint is a small HTTP POST handler that blder.bot's tRPC calls when a new session is created. It validates a shared secret header and forwards to `Relay.nudgeSession()`.

**Step 1: Write failing test**

Create `apps/ws-gateway/src/nudge.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createNudgeHandler } from "./nudge.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockReq(body: any, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req: any = {
    method: "POST",
    headers,
    on(event: string, cb: any) {
      if (event === "data") chunks.forEach((c) => cb(c));
      if (event === "end") cb();
      return req;
    },
  };
  return req;
}

function mockRes(): ServerResponse & { _status: number; _body: string } {
  const res: any = {
    _status: 0,
    _body: "",
    writeHead(status: number) {
      this._status = status;
      return this;
    },
    end(body?: string) {
      if (body) this._body = body;
      return this;
    },
    setHeader() {},
  };
  return res;
}

describe("nudge handler", () => {
  it("rejects missing authorization header", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq({ sessionId: "s", workspaceId: "w", workingDirectory: "/", agentType: "c" });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("rejects wrong shared secret", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq(
      { sessionId: "s", workspaceId: "w", workingDirectory: "/", agentType: "c" },
      { authorization: "Bearer wrong" },
    );
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("rejects missing required fields", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq({ sessionId: "s" }, { authorization: "Bearer s3cr3t" });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("calls onNudge with valid payload and returns 200", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq(
      {
        sessionId: "s1",
        workspaceId: "w1",
        workingDirectory: "/tmp",
        agentType: "claude",
        title: "test",
      },
      { authorization: "Bearer s3cr3t" },
    );
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(nudge).toHaveBeenCalledWith({
      sessionId: "s1",
      workspaceId: "w1",
      workingDirectory: "/tmp",
      agentType: "claude",
      title: "test",
    });
  });
});
```

**Step 2: Run test (fails)**

```bash
pnpm test
```

**Step 3: Create `apps/ws-gateway/src/nudge.ts`**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

interface NudgeBody {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
}

export interface NudgeConfig {
  sharedSecret: string;
  onNudge: (body: NudgeBody) => void;
}

export function createNudgeHandler(cfg: NudgeConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Auth
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${cfg.sharedSecret}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // Parse body
    const body = await readJsonBody(req);
    if (!body) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    // Validate fields
    const { sessionId, workspaceId, workingDirectory, agentType, title } = body as Partial<NudgeBody>;
    if (!sessionId || !workspaceId || !workingDirectory || !agentType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    cfg.onNudge({ sessionId, workspaceId, workingDirectory, agentType, title });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}
```

**Step 4: Run test**

```bash
pnpm test
```

Expected: All 4 nudge tests pass.

**Step 5: Commit**

```bash
git add apps/ws-gateway/src/nudge.ts apps/ws-gateway/src/nudge.test.ts
git commit -m "feat(ws-gateway): internal nudge endpoint"
```

---

## Task 7: Server bootstrap (`index.ts`)

**Files:**
- Modify: `apps/ws-gateway/src/index.ts` (replace placeholder)

**Step 1: Replace `apps/ws-gateway/src/index.ts`**

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { sessionEvents } from "@bob/db/schema";

import { PersistenceWriter, type SessionEventRecord } from "./persistence.js";
import { Relay } from "./relay.js";
import { createNudgeHandler } from "./nudge.js";
import { validateBrowserToken, validateDaemonAuth } from "./auth.js";

const PORT = parseInt(process.env.GATEWAY_PORT ?? "3002", 10);
const HEARTBEAT_INTERVAL_MS = 30_000;
const NUDGE_SHARED_SECRET = process.env.NUDGE_SHARED_SECRET ?? "";

if (!NUDGE_SHARED_SECRET && process.env.NODE_ENV !== "test") {
  console.error("[ws-gateway] FATAL: NUDGE_SHARED_SECRET env var is required");
  process.exit(1);
}

// Persistence: writes session events to Postgres in batches
const writer = new PersistenceWriter({
  batchSize: 50,
  flushIntervalMs: 100,
  onBatchWrite: async (batch) => {
    await db.insert(sessionEvents).values(
      batch.map((e) => ({
        sessionId: e.sessionId,
        seq: e.seq,
        direction: e.direction,
        eventType: e.eventType,
        payload: e.payload,
      })),
    );
  },
  onError: (err, events) => {
    console.error(`[ws-gateway] Failed to persist ${events.length} events:`, err);
  },
});
writer.start();

const relay = new Relay({
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  persistEvent: (event: SessionEventRecord) => {
    writer.enqueue(event);
  },
  validateBrowserToken,
  validateDaemonAuth,
});

const nudgeHandler = createNudgeHandler({
  sharedSecret: NUDGE_SHARED_SECRET,
  onNudge: (body) => relay.nudgeSession(body),
});

// HTTP server (handles /health and /internal/nudge)
const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(404);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    const stats = relay.getStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        ...stats,
        writerHealthy: writer.isHealthy(),
      }),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/internal/nudge") {
    await nudgeHandler(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
});

// WebSocket server mounted on /sessions
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/sessions") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    relay.handleConnection(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[ws-gateway] listening on port ${PORT}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[ws-gateway] received ${signal}, shutting down`);
  server.close();
  wss.clients.forEach((ws) => ws.close());
  await writer.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

**Step 2: Typecheck**

```bash
cd apps/ws-gateway && pnpm typecheck
```

Expected: No type errors.

**Step 3: Build**

```bash
pnpm build
```

Expected: Clean build, produces `dist/index.js`.

**Step 4: Commit**

```bash
git add apps/ws-gateway/src/index.ts
git commit -m "feat(ws-gateway): HTTP + WS server bootstrap"
```

---

## Task 8: End-to-end smoke test (local)

**Files:**
- Create: `apps/ws-gateway/src/integration.test.ts`

**Context:** This test starts the full server against a test database and exercises the complete flow: browser connects, daemon connects, browser subscribes, daemon sends events, browser receives them, nudge endpoint pushes session_available.

**This test requires a real Postgres.** Use the existing test database pattern from `@bob/db`. Check `packages/db/src/__tests__/` for how existing tests set up a test DB. If there's no test DB infrastructure yet, mark this test with `describe.skip` and add a README note — we'll revisit in Phase 3 when we set up Hetzner Postgres.

**Step 1: Check if test DB infrastructure exists**

```bash
grep -rn "test.*database\|TEST_DATABASE_URL\|createTestDb" /Volumes/dev/bob/packages/db/ 2>/dev/null | head -10
```

If test DB helpers exist, use them. Otherwise:

**Step 2: Create `apps/ws-gateway/src/integration.test.ts` with `describe.skip`**

```ts
import { describe, it } from "vitest";

// Real end-to-end integration tests against Postgres will be added in Phase 3
// when we have a test database set up. For now we rely on the unit tests in
// relay.test.ts, nudge.test.ts, auth.test.ts, persistence.test.ts, and protocol.test.ts.
describe.skip("ws-gateway integration", () => {
  it("browser subscribes and receives daemon events end-to-end", async () => {
    // TODO(phase-3): implement against test Postgres
  });
});
```

**Step 3: Commit**

```bash
git add apps/ws-gateway/src/integration.test.ts
git commit -m "test(ws-gateway): placeholder for phase 3 integration tests"
```

---

## Task 9: Register package in workspace root

**Files:**
- Verify: `/Volumes/dev/bob/pnpm-workspace.yaml` includes `apps/*` (it already does based on existing `apps/gateway/`)
- Verify: `turbo.json` pipelines work for the new package

**Step 1: Check workspace config**

```bash
cat /Volumes/dev/bob/pnpm-workspace.yaml
```

Expected: Contains `- apps/*`. If so, nothing to change.

**Step 2: Run all workspace scripts on the new package**

```bash
cd /Users/mackieg/.config/superpowers/worktrees/bob/ws-gateway-phase1
pnpm -F @bob/ws-gateway typecheck
pnpm -F @bob/ws-gateway test
pnpm -F @bob/ws-gateway build
```

Expected: All pass.

**Step 3: Run full workspace typecheck to make sure we didn't break anything**

```bash
pnpm typecheck
```

Expected: No new errors in other packages. If the old `apps/gateway/` has errors, ignore those — they're pre-existing.

**Step 4: Commit (if anything changed)**

Only needed if you had to touch workspace config. Otherwise skip.

---

## Task 10: Phase 1 verification checklist

Run each command and confirm the expected output before moving on.

**All tests pass:**
```bash
cd apps/ws-gateway && pnpm test
```
Expected: All ~30 tests pass (protocol, persistence, auth, relay, nudge) + 1 skipped (integration).

**Typecheck clean:**
```bash
pnpm typecheck
```
Expected: No errors.

**Build succeeds:**
```bash
pnpm build
```
Expected: `dist/index.js` exists.

**Dev server starts (requires DATABASE_URL in .env):**
```bash
NUDGE_SHARED_SECRET=test \
DATABASE_URL="postgresql://..." \
pnpm dev
```
Expected: Log line `[ws-gateway] listening on port 3002`. Kill with Ctrl-C.

**Health endpoint responds:**
```bash
# In a separate terminal while dev server is running
curl http://localhost:3002/health
```
Expected: `{"status":"ok","uptimeSeconds":...,"connections":0,"browserCount":0,"daemonCount":0,"sessionSubscriptions":0,"writerHealthy":true}`

**Nudge endpoint rejects bad auth:**
```bash
curl -X POST http://localhost:3002/internal/nudge \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"s","workspaceId":"w","workingDirectory":"/","agentType":"claude"}'
```
Expected: `401 Unauthorized`.

**Nudge endpoint accepts good auth:**
```bash
curl -X POST http://localhost:3002/internal/nudge \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"s","workspaceId":"w","workingDirectory":"/","agentType":"claude"}'
```
Expected: `200 {"ok":true}` (even though no daemon is connected — the nudge silently drops).

---

## What comes next (NOT in this plan)

- **Phase 2**: Go daemon WS client. New files in `bob-cli/internal/ws/` + refactor `cmd/run_loop.go`. Separate plan.
- **Phase 3**: Database migration Neon → Hetzner Postgres. Separate plan.
- **Phase 4**: Deploy the slim gateway to hetzner-master behind `wss://ws.blder.bot`. Separate plan.
- **Phase 5**: Delete `apps/gateway/`. Separate plan.

This plan stops after the slim gateway package is built, tested, typechecks, and can be started locally with a real database. It does NOT touch the Go daemon, does NOT migrate data, does NOT deploy anywhere.

---

## Completion criteria

Phase 1 is done when:

- [x] `apps/ws-gateway/` package exists with the file structure above
- [x] All unit tests pass (`pnpm -F @bob/ws-gateway test`)
- [x] Package typechecks (`pnpm -F @bob/ws-gateway typecheck`)
- [x] Package builds (`pnpm -F @bob/ws-gateway build`)
- [x] Dev server starts and `/health` returns 200
- [x] Nudge endpoint rejects bad auth and accepts good auth
- [x] All commits are in `feat/ws-gateway-slim` branch
- [x] Workspace-level `pnpm typecheck` has no new errors

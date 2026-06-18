# Phase 3: Effect Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate gmacko backend from tRPC + Zod to Effect-RPC + Effect/Schema, aligning with t3code patterns for the eventual fork.

**Architecture:** Effect services with typed dependency injection via Layers. RPC contracts defined with `Rpc.make()` + `Schema`. Server handles RPC via `RpcGroup.toLayer()`. Web/mobile clients consume via typed RPC client wrapper. Drizzle ORM stays for database access, wrapped in Effect services.

**Tech Stack:** Effect 4.0.0-beta.43, @effect/platform-node, @effect/vitest, Effect/Schema, Effect/unstable/rpc

---

## Phase 3A: Foundation

### Task 23: Add Effect dependencies to monorepo

**Files:**
- Modify: root `package.json` (add catalog)
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/rpc.ts`
- Create: `packages/contracts/src/schemas/thread.ts`
- Create: `packages/contracts/src/schemas/branch.ts`
- Create: `packages/contracts/src/schemas/message.ts`
- Create: `packages/contracts/src/schemas/wiki.ts`
- Create: `packages/contracts/src/errors.ts`

**Step 1: Add Effect to root package.json catalog**

Add to root package.json:
```json
{
  "pnpm": {
    "overrides": {}
  },
  "catalogs": {
    "default": {
      "effect": "4.0.0-beta.43",
      "@effect/platform": "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
      "@effect/vitest": "4.0.0-beta.43"
    }
  }
}
```

**Step 2: Create @gmacko/contracts package**

This replaces Zod schemas with Effect/Schema and defines the RPC interface.

```json
// packages/contracts/package.json
{
  "name": "@gmacko/contracts",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "typescript": "^5.9.0"
  }
}
```

**Step 3: Define schemas with Effect/Schema**

```ts
// packages/contracts/src/schemas/thread.ts
import { Schema } from "effect";

export const ThreadStatus = Schema.Literal("active", "paused", "archived", "completed");
export type ThreadStatus = typeof ThreadStatus.Type;

export const Thread = Schema.Struct({
  id: Schema.UUID,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  status: ThreadStatus,
  activeBranchId: Schema.NullOr(Schema.UUID),
  tags: Schema.Array(Schema.String),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type Thread = typeof Thread.Type;

export const CreateThreadInput = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  tags: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
});

export const UpdateThreadStatusInput = Schema.Struct({
  id: Schema.UUID,
  status: ThreadStatus,
});
```

```ts
// packages/contracts/src/schemas/branch.ts
import { Schema } from "effect";

export const Branch = Schema.Struct({
  id: Schema.UUID,
  threadId: Schema.UUID,
  parentBranchId: Schema.NullOr(Schema.UUID),
  forkPointMessageId: Schema.NullOr(Schema.UUID),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  createdAt: Schema.DateFromSelf,
});
export type Branch = typeof Branch.Type;

export const CreateBranchInput = Schema.Struct({
  threadId: Schema.UUID,
  parentBranchId: Schema.UUID,
  forkPointMessageId: Schema.UUID,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
});

export const SetActiveBranchInput = Schema.Struct({
  threadId: Schema.UUID,
  branchId: Schema.UUID,
});
```

```ts
// packages/contracts/src/schemas/message.ts
import { Schema } from "effect";

export const MessageRole = Schema.Literal("user", "assistant", "system");

export const Message = Schema.Struct({
  id: Schema.UUID,
  threadId: Schema.UUID,
  branchId: Schema.UUID,
  parentId: Schema.NullOr(Schema.UUID),
  role: MessageRole,
  content: Schema.String,
  metadata: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.Unknown }), { default: () => ({}) }),
  createdAt: Schema.DateFromSelf,
});
export type Message = typeof Message.Type;

export const CreateMessageInput = Schema.Struct({
  threadId: Schema.UUID,
  branchId: Schema.UUID,
  parentId: Schema.NullOr(Schema.UUID),
  role: MessageRole,
  content: Schema.String.pipe(Schema.minLength(1)),
  metadata: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.Unknown }), { default: () => ({}) }),
});

export const ChatInput = Schema.Struct({
  threadId: Schema.UUID,
  branchId: Schema.UUID,
  content: Schema.String.pipe(Schema.minLength(1)),
});
```

```ts
// packages/contracts/src/schemas/wiki.ts
import { Schema } from "effect";

export const WikiArticle = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  outboundLinks: Schema.Array(Schema.String),
});
export type WikiArticle = typeof WikiArticle.Type;

export const SynthesizeInput = Schema.Struct({
  threadId: Schema.UUID,
  branchId: Schema.UUID,
  title: Schema.String.pipe(Schema.minLength(1)),
  tags: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
});

export const SynthesizeResult = Schema.Struct({
  filePath: Schema.String,
  slug: Schema.String,
  title: Schema.String,
});
```

**Step 4: Define errors**

```ts
// packages/contracts/src/errors.ts
import { Schema } from "effect";

export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class BranchNotFoundError extends Schema.TaggedError<BranchNotFoundError>()(
  "BranchNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class AgentError extends Schema.TaggedError<AgentError>()(
  "AgentError",
  { message: Schema.String },
) {}

export class WikiError extends Schema.TaggedError<WikiError>()(
  "WikiError",
  { message: Schema.String },
) {}
```

**Step 5: Define RPC group**

```ts
// packages/contracts/src/rpc.ts
import { Rpc, RpcGroup, Schema } from "effect";
import { Thread, CreateThreadInput, UpdateThreadStatusInput } from "./schemas/thread";
import { Branch, CreateBranchInput, SetActiveBranchInput } from "./schemas/branch";
import { Message, CreateMessageInput, ChatInput } from "./schemas/message";
import { WikiArticle, SynthesizeInput, SynthesizeResult } from "./schemas/wiki";
import { ThreadNotFoundError, BranchNotFoundError, AgentError, WikiError } from "./errors";

export const METHODS = {
  // Threads
  threadsList: "threads.list",
  threadsById: "threads.byId",
  threadsCreate: "threads.create",
  threadsUpdateStatus: "threads.updateStatus",
  // Branches
  branchesListByThread: "branches.listByThread",
  branchesCreate: "branches.create",
  branchesSetActive: "branches.setActive",
  // Messages
  messagesListByBranch: "messages.listByBranch",
  messagesCreate: "messages.create",
  // Agent
  agentChat: "agent.chat",
  // Wiki
  wikiSynthesize: "wiki.synthesize",
  wikiList: "wiki.list",
  wikiOrphans: "wiki.orphans",
} as const;

// --- Thread RPCs ---
export const ThreadsListRpc = Rpc.make(METHODS.threadsList, {
  payload: Schema.Struct({}),
  success: Schema.Array(Thread),
});

export const ThreadsByIdRpc = Rpc.make(METHODS.threadsById, {
  payload: Schema.Struct({ id: Schema.UUID }),
  success: Thread,
  error: ThreadNotFoundError,
});

export const ThreadsCreateRpc = Rpc.make(METHODS.threadsCreate, {
  payload: CreateThreadInput,
  success: Thread,
});

export const ThreadsUpdateStatusRpc = Rpc.make(METHODS.threadsUpdateStatus, {
  payload: UpdateThreadStatusInput,
  success: Thread,
  error: ThreadNotFoundError,
});

// --- Branch RPCs ---
export const BranchesListByThreadRpc = Rpc.make(METHODS.branchesListByThread, {
  payload: Schema.Struct({ threadId: Schema.UUID }),
  success: Schema.Array(Branch),
});

export const BranchesCreateRpc = Rpc.make(METHODS.branchesCreate, {
  payload: CreateBranchInput,
  success: Branch,
});

export const BranchesSetActiveRpc = Rpc.make(METHODS.branchesSetActive, {
  payload: SetActiveBranchInput,
  success: Schema.Void,
});

// --- Message RPCs ---
export const MessagesListByBranchRpc = Rpc.make(METHODS.messagesListByBranch, {
  payload: Schema.Struct({ threadId: Schema.UUID, branchId: Schema.UUID }),
  success: Schema.Array(Message),
});

export const MessagesCreateRpc = Rpc.make(METHODS.messagesCreate, {
  payload: CreateMessageInput,
  success: Message,
});

// --- Agent RPCs ---
export const AgentChatRpc = Rpc.make(METHODS.agentChat, {
  payload: ChatInput,
  success: Message,
  error: AgentError,
});

// --- Wiki RPCs ---
export const WikiSynthesizeRpc = Rpc.make(METHODS.wikiSynthesize, {
  payload: SynthesizeInput,
  success: SynthesizeResult,
  error: WikiError,
});

export const WikiListRpc = Rpc.make(METHODS.wikiList, {
  payload: Schema.Struct({}),
  success: Schema.Array(WikiArticle),
});

export const WikiOrphansRpc = Rpc.make(METHODS.wikiOrphans, {
  payload: Schema.Struct({}),
  success: Schema.Array(Schema.String),
});

// --- RPC Group ---
export const GmackoRpcGroup = RpcGroup.make(
  ThreadsListRpc,
  ThreadsByIdRpc,
  ThreadsCreateRpc,
  ThreadsUpdateStatusRpc,
  BranchesListByThreadRpc,
  BranchesCreateRpc,
  BranchesSetActiveRpc,
  MessagesListByBranchRpc,
  MessagesCreateRpc,
  AgentChatRpc,
  WikiSynthesizeRpc,
  WikiListRpc,
  WikiOrphansRpc,
);
```

```ts
// packages/contracts/src/index.ts
export * from "./rpc";
export * from "./errors";
export * from "./schemas/thread";
export * from "./schemas/branch";
export * from "./schemas/message";
export * from "./schemas/wiki";
```

**Step 6: Install and commit**

```bash
pnpm install
git add -A && git commit -m "feat: add @gmacko/contracts with Effect/Schema types and RPC group"
```

---

### Task 24: Create @gmacko/server with Effect services

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/services/database.ts`
- Create: `apps/server/src/services/agent.ts`
- Create: `apps/server/src/services/wiki.ts`
- Create: `apps/server/src/rpc-handler.ts`

**Step 1: Create the server app**

The server app hosts the RPC handler. It uses Effect services for database, agent, and wiki operations.

Database service wraps Drizzle. Agent service wraps the Claude dispatch. Wiki service wraps the writer/linker.

Each service follows the pattern:
```ts
export class DatabaseService extends Effect.Service<DatabaseService>()("DatabaseService", {
  // ... service implementation
}) {}
```

**Step 2: Create RPC handler**

```ts
// apps/server/src/rpc-handler.ts
// Uses GmackoRpcGroup.toLayer() pattern from t3code
// Each handler: (input) => Effect.Effect<Success, Error, Requirements>
// Dependencies injected via yield* ServiceName
```

**Step 3: Create HTTP adapter**

Expose the RPC group via HTTP (fetch adapter) so Next.js API routes can proxy to it, or serve directly.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Effect server with RPC handler and service layers"
```

---

### Task 25: Update Next.js web app to consume Effect-RPC

**Files:**
- Modify: `apps/web/src/trpc/react.tsx` → `apps/web/src/rpc/client.tsx`
- Modify: `apps/web/src/app/api/trpc/[...trpc]/route.ts` → `apps/web/src/app/api/rpc/[...rpc]/route.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/package.json`

**Step 1: Create RPC client wrapper**

Similar to t3code's wsRpcClient.ts pattern — typed methods that delegate to transport:
```ts
export interface GmackoRpcClient {
  threads: {
    list: () => Promise<Thread[]>;
    byId: (id: string) => Promise<Thread>;
    create: (input: CreateThreadInput) => Promise<Thread>;
    // ...
  };
  // ...
}
```

For now, use HTTP transport (fetch-based) instead of WebSocket. WebSocket comes later when we add streaming.

**Step 2: Wire React Query**

Keep React Query for cache/state management. Each RPC method gets a React Query wrapper:
```ts
export function useThreadsList() {
  return useQuery({ queryKey: ["threads", "list"], queryFn: () => rpcClient.threads.list() });
}
```

**Step 3: Update pages to use new client**

**Step 4: Remove tRPC dependencies**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: migrate web app from tRPC to Effect-RPC client"
```

---

### Task 26: Update mobile app to consume Effect-RPC

**Files:**
- Modify: `apps/mobile/src/utils/api.tsx`
- Modify: `apps/mobile/src/app/index.tsx`
- Modify: `apps/mobile/src/app/thread/[id].tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/mobile/package.json`

**Step 1: Create mobile RPC client**

Same pattern as web — typed methods over HTTP transport. Share the client interface type from contracts.

**Step 2: Replace tRPC calls with RPC client calls**

**Step 3: Remove tRPC dependencies from mobile**

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: migrate mobile app from tRPC to Effect-RPC client"
```

---

### Task 27: Remove old tRPC packages and clean up

**Files:**
- Delete: `packages/api/` (replaced by contracts + server)
- Modify: `packages/agent/` — wrap in Effect
- Modify: `packages/wiki/` — wrap in Effect
- Modify: root `package.json` — remove tRPC from any shared deps
- Modify: `CLAUDE.md`

**Step 1: Wrap agent dispatch in Effect**

```ts
// packages/agent/src/dispatch.ts
import { Effect, Stream } from "effect";

export const dispatchAgent = (opts: DispatchOptions): Stream.Stream<AgentEvent, AgentError> =>
  Stream.async((emit) => {
    // ... wrap the existing async generator in an Effect stream
  });
```

**Step 2: Wrap wiki in Effect**

```ts
// packages/wiki/src/writer.ts
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";

export const writeArticle = (vaultPath: string, article: WikiArticle): Effect.Effect<string, WikiError, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // ... use Effect file system instead of Node fs/promises
  });
```

**Step 3: Delete packages/api, update references**

**Step 4: Update CLAUDE.md**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: complete Effect migration — remove tRPC, wrap agent+wiki in Effect"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 23 | Add Effect deps, create @gmacko/contracts with Schema types + RPC group |
| 24 | Create Effect server with services (DB, agent, wiki) + RPC handler |
| 25 | Migrate web app from tRPC to Effect-RPC client |
| 26 | Migrate mobile app from tRPC to Effect-RPC client |
| 27 | Remove tRPC, wrap agent+wiki in Effect, clean up |

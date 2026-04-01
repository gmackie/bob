# Work Items REST Client Getting Started Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the work-items REST API easy to adopt across Bob apps by shipping a shared TypeScript client plus a concrete integration checklist that downstream teams can follow without reverse-engineering the REST adapter.

**Architecture:** Keep the server-side REST adapter in `@bob/api` and `apps/web` as the source of truth. Add a lightweight client in `@bob/work-items` that knows the operation paths, accepts a caller-supplied `fetch`, and lets each app inject its own auth strategy. Adoption should be incremental: one shared client package, then per-app wrappers only where local ergonomics differ.

**Tech Stack:** TypeScript, Zod v4, Vitest, Next.js App Router REST routes, Bob workspace packages

### Task 1: Verify the published REST surface

**Files:**
- Read: `packages/api/src/contracts/work-items-rest.ts`
- Read: `packages/api/src/openapi.ts`
- Read: `apps/web/src/app/api/openapi/route.ts`
- Read: `apps/web/src/app/api/v1/work-items/*/route.ts`

**Step 1: Confirm the canonical endpoint shape**

The REST surface is RPC-style and currently exposes `POST` endpoints under `/api/v1/work-items/*`.

Operations:

- `/api/v1/work-items/list`
- `/api/v1/work-items/get`
- `/api/v1/work-items/promote-to-task`
- `/api/v1/work-items/list-comments`
- `/api/v1/work-items/create-comment`
- `/api/v1/work-items/create-artifact`
- `/api/v1/work-items/list-activities`
- `/api/v1/work-items/list-current-artifacts`
- `/api/v1/work-items/list-child-artifact-groups`
- `/api/v1/work-items/list-notifications`
- `/api/v1/work-items/create-notification`
- `/api/v1/work-items/mark-notification-as-read`

**Step 2: Confirm the OpenAPI document**

Run:

```bash
pnpm --filter @bob/web dev
curl http://localhost:3000/api/openapi | jq '.paths | keys[]'
```

Expected: every route above appears in the OpenAPI document.

### Task 2: Ship the shared TypeScript client package

**Files:**
- Modify: `packages/work-items/package.json`
- Create: `packages/work-items/src/client.ts`
- Create: `packages/work-items/src/client.test.ts`
- Modify: `packages/work-items/src/index.ts`

**Step 1: Expose a transport-agnostic client factory**

The shared package should export:

- `createWorkItemsClient(options)`
- `WorkItemsClient`
- `WorkItemsClientOptions`
- typed input and output aliases for each operation

Recommended factory shape:

```ts
const client = createWorkItemsClient({
  baseUrl: "https://bob.example.com",
  fetch: globalThis.fetch,
  getHeaders: async () => ({
    cookie: sessionCookie,
  }),
});
```

**Step 2: Keep auth outside the client core**

The client should not own session state. It should only:

- build the request URL
- POST JSON
- merge caller headers
- decode JSON
- throw a typed error on non-2xx responses

Auth should be injected by the consuming app through `getHeaders`.

**Step 3: Make the client methods 1:1 with the REST operations**

Required methods:

```ts
client.list(input)
client.get(input)
client.promoteToTask(input)
client.listComments(input)
client.createComment(input)
client.createArtifact(input)
client.listActivities(input)
client.listCurrentArtifacts(input)
client.listChildArtifactGroups(input)
client.listNotifications(input)
client.createNotification(input)
client.markNotificationAsRead(input)
```

### Task 3: Define the downstream app adoption pattern

**Files:**
- Read: `apps/web/src/lib/rest/api-helpers.ts`
- Read: `apps/mobile/src/utils/api.tsx`
- Read: `apps/gateway/src/index.ts`

**Step 1: Web app usage**

For browser code running on the same origin:

```ts
const client = createWorkItemsClient({
  baseUrl: "",
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});
```

Use this for client-side reads and mutations where tRPC is not already the better fit.

**Step 2: Mobile app usage**

For mobile:

```ts
const client = createWorkItemsClient({
  baseUrl: baseUrlFromEnv,
  fetch,
  getHeaders: async () => ({
    cookie: sessionCookie,
  }),
});
```

The mobile shell should own session acquisition and persistence. The shared client should stay stateless.

**Step 3: Server or worker usage**

For gateway or execution-style consumers:

```ts
const client = createWorkItemsClient({
  baseUrl: bobApiUrl,
  fetch,
  getHeaders: async () => ({
    cookie: sessionCookie,
    "x-request-id": requestId,
  }),
});
```

### Task 4: Document failure handling and observability

**Files:**
- Create or extend: `packages/work-items/src/client.ts`
- Reference: `apps/web/src/lib/rest/api-helpers.ts`

**Step 1: Normalize non-2xx responses**

Return a thrown error that includes:

- `status`
- `message`
- `path`
- `requestId` if present in response headers
- parsed response body when JSON is available

**Step 2: Keep retries out of v1**

Do not hide retries, backoff, or caching inside the core client. Let each app decide that policy. The v1 client should stay thin and predictable.

### Task 5: Add the first consumer rollout

**Files:**
- Modify: one downstream app once the client lands

**Step 1: Pick one non-tRPC consumer path**

Recommended order:

1. mobile read path
2. gateway/server integration
3. web browser integration

Start with a single read endpoint such as `list` or `get`, confirm ergonomics, then expand.

**Step 2: Verify with one live request**

Run a real request against a local or staging Bob instance and capture:

- request body
- response body
- auth mechanism used
- any error normalization behavior

### Task 6: Verification checklist

**Files:**
- Verify all touched files

Run:

```bash
pnpm --filter @bob/work-items test
pnpm --filter @bob/work-items typecheck
pnpm --filter @bob/api test -- --run packages/api/src/__tests__/work-items-openapi.test.ts
```

Expected:

- the shared client tests pass
- `@bob/work-items` typechecks
- the OpenAPI contract test still passes

## Getting Started Summary for App Teams

1. Depend on `@bob/work-items`.
2. Create one app-local client instance with `baseUrl`, `fetch`, and optional `getHeaders`.
3. Start with `list` or `get` to prove auth and base URL wiring.
4. Reuse the same client instance for other work-item operations.
5. Handle thrown client errors at the app boundary instead of swallowing them in the shared package.

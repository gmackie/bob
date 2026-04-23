# OODA integration guide for `@gmacko/client`

A self-contained guide for wiring `@gmacko/client` + `@gmacko/contracts` into
the OODA web/mobile apps. Everything below is implemented as of Phase 6F
(inserted 2026-04-21); the back-end handlers that fulfil these contracts
swap from the deterministic stubs shipped now to real service-backed
implementations in **6K** without breaking OODA's consumer code.

---

## 1. Overview

`@gmacko/client` is a typed SDK that wraps four Effect-RPC groups
(`AuthRpc`, `ProjectsRpc`, `SecretsRpc`, `AgentRpc`) defined in
`@gmacko/contracts`. It exposes a plain Promise / `AsyncIterable` API so
OODA's browser + mobile consumers never need an Effect runtime.

**Phase status — 6F (contracts-first):**

- Wire-level Schema contracts are frozen for the four groups.
- Server-side handlers ship as deterministic **stubs** from
  `@gmacko/contracts/stubs/*`. They return fixed UUIDs, fixed timestamps,
  and fixed mock content so golden-style tests are stable.
- Real implementations land in 6K (`Wire reference apps/web end-to-end`).
  The Schema shapes won't change — swapping stubs for real services is
  transparent to OODA.

**Monorepo shape today:** 32 packages under `packages/`, including the
new `@gmacko/client` and contract groups. OODA consumes two:
`@gmacko/client` and `@gmacko/contracts` (for schema types and error
classes).

**Architecture, one-liner:**

```
OODA browser/mobile code
    └─ @gmacko/client          (Promise / AsyncIterable facade)
         └─ RpcClient over HTTP (JSON)
             └─ server route handler
                  └─ Layer.mergeAll(stub handlers in 6F; real services in 6K)
```

---

## 2. Install & quick start

### 2.1 Install

While the packages are still workspace-local (pre-npm-publish), add them
as workspace deps or tarball links:

```jsonc
// OODA's package.json
{
  "dependencies": {
    "@gmacko/client": "workspace:*",
    "@gmacko/contracts": "workspace:*"
  }
}
```

Once the `@gmacko` packages publish to npm you'll `pnpm add` them
normally. The `exports` map on `@gmacko/contracts` supports the
`./groups/*`, `./schemas/*`, and `./stubs/*` subpaths — use those in
server-side code so bundlers can tree-shake cleanly.

### 2.2 Quick start — call one procedure

```ts
import { createGmackoRpcClient } from "@gmacko/client";

const client = createGmackoRpcClient({
  baseURL: "http://localhost:3000/rpc", // must match your server's mount path
});

const me = await client.auth.whoAmI();
// → { userId: "user_stub_abc",
//     tenantId: "00000000-0000-0000-0000-000000000001",
//     email: "stub@example.com",
//     role: "owner" }
```

The four facade groups (`auth`, `projects`, `secrets`, `agent`) all share
the transport layer built inside `createGmackoRpcClient`. Every non-
streaming procedure returns a `Promise`; `agent.sendTurn` is the only
streaming procedure and returns an `AsyncIterable<AgentEventWire>` that
you consume with `for await`.

`GmackoClientOptions`:

```ts
interface GmackoClientOptions {
  readonly baseURL: string;                 // required, e.g. "/rpc" or full URL
  readonly fetch?: typeof fetch;            // override for tests or edge runtimes
  readonly headers?: Record<string, string>; // applied to every outbound request
}
```

Headers are injected via `RpcClient.layerProtocolHttp`'s `transformClient`
hook — they compose above serialization and flow with every RPC call.

---

## 3. Spinning up a stub server for local dev

In 6F, the only way to get a server responding to these contracts is to
compose the stub handler Layers yourself. 6K ships `apps/web` with the
same composition wired into a Next.js route handler — until then, use
the pattern below in OODA's dev harness.

Source of truth: `packages/client/src/__tests__/e2e.test.ts` — the code
below is a trimmed version of that test. Copy it into a dev script to
get a local stub server you can point `createGmackoRpcClient` at.

### 3.1 Minimal Node stub server

```ts
// dev-stub-server.ts
import { createServer } from "node:http";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { AuthRpc } from "@gmacko/contracts/groups/auth";
import { ProjectsRpc } from "@gmacko/contracts/groups/projects";
import { SecretsRpc } from "@gmacko/contracts/groups/secrets";
import { AgentRpc } from "@gmacko/contracts/groups/agent";
import { stubAuthHandlers } from "@gmacko/contracts/stubs/auth";
import { stubProjectsHandlersLayer } from "@gmacko/contracts/stubs/projects";
import { layerStubSecretsHandlers } from "@gmacko/contracts/stubs/secrets";
import { stubAgentHandlers } from "@gmacko/contracts/stubs/agent";

// 1. Merge the four RpcGroups so the whole surface mounts on one path.
const MergedRpc = AuthRpc.merge(ProjectsRpc, SecretsRpc, AgentRpc);

// 2. Merge the four stub handler Layers. Each provides a disjoint slice of
//    Rpc.ToHandler<MergedRpc> so Layer.mergeAll composes cleanly.
const mergedHandlers = Layer.mergeAll(
  stubAuthHandlers,
  stubProjectsHandlersLayer,
  layerStubSecretsHandlers,
  stubAgentHandlers.layer,
);

// 3. Build the RpcServer HTTP Layer. JSON serialization matches what the
//    client uses (RpcSerialization.layerJson).
const serverLayer = RpcServer.layerHttp({
  group: MergedRpc,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(mergedHandlers),
  Layer.provide(RpcSerialization.layerJson),
);

// 4. Convert to a WHATWG (Request) => Promise<Response> handler.
const { handler } = HttpRouter.toWebHandler(serverLayer);

// 5. Bind to Node's http module. See the e2e test for the full
//    buildWebRequest / writeWebResponse adapters — omitted here for brevity.
createServer(async (req, res) => {
  // ... read body, build Request, call handler, write Response ...
}).listen(3000, "127.0.0.1");
```

See `packages/client/src/__tests__/e2e.test.ts` (lines 80-145) for the
exact Node ↔ WHATWG adapter functions (`readNodeRequestBody`,
`buildWebRequest`, `writeWebResponse`). 6F didn't ship `@effect/platform-node`
so the adapter is hand-rolled — this is expected to be replaced in 6K.

### 3.2 Alternative: use `apps/web` once 6K ships

After 6K lands, `apps/web` will expose `/rpc` wired with the *real*
handlers. OODA can simply point `baseURL: "https://apps-web.../rpc"`
at that. For now, only the stub-server path is available.

---

## 4. Per-group surface

All four groups follow the same pattern: the Promise-returning facade
methods match the RPC procedure names 1:1. Errors thrown from
`await` are tagged classes — see §5 for the catch pattern.

### 4.1 Auth — 9 procedures

```ts
// Identity / tenancy
await client.auth.whoAmI();
//   → { userId, tenantId, email, role: "owner"|"admin"|"member" }
await client.auth.listMemberships();
//   → ReadonlyArray<{ tenantId, role }>
await client.auth.resolveTenant({ tenantIdHint });
//   → { tenantId, role } | throws TenantNotSelectedError

// API keys
await client.auth.issueApiKey({
  name: "ci-token",
  permissions: ["read", "write"],
  ttlMs: 7 * 24 * 3600 * 1000, // optional
});
//   → { id, plaintext, keyPrefix }   — plaintext returned ONCE at issue time
await client.auth.listApiKeys();
//   → ReadonlyArray<ApiKeyListItem>  — no plaintext
await client.auth.revokeApiKey({ apiKeyId });
//   → void | throws InvalidApiKeyError

// Device flow
await client.auth.startDeviceFlow();
//   → { deviceCode, userCode, verificationUri, expiresAt }
await client.auth.pollDeviceCode({ deviceCode });
//   → { status: "pending"|"approved"|"consumed"|"denied"|"expired", ... }
//     — "consumed" variant includes the minted { apiKey: { id, plaintext } }
await client.auth.approveDeviceCode({ userCode, tenantId });
//   → void | throws InvalidUserCodeError | AlreadyApprovedError
```

**Stub data** (`packages/contracts/src/stubs/auth.ts`):

- `whoAmI` → `userId: "user_stub_abc"`, `tenantId:
  "00000000-0000-0000-0000-000000000001"`, `email: "stub@example.com"`,
  `role: "owner"`.
- `listMemberships` → 1 membership, same tenant + role.
- `issueApiKey` → always returns the fixed plaintext
  `"gmk_stub_plaintext_value_for_tests_only"` — never real, obviously.
- `listApiKeys` → 1 key named `"Stub API key"`.
- `revokeApiKey` → success only when `apiKeyId` matches the stub id;
  otherwise `InvalidApiKeyError`.
- `startDeviceFlow` → `{ deviceCode: "stub_device_code_abc",
  userCode: "WXYZ-1234", verificationUri: "https://stub.example/device",
  expiresAt: 2026-04-20T00:00:00Z }`.
- `pollDeviceCode` → always `"pending"` (never progresses — the real
  impl in 6K will drive the lifecycle).
- `approveDeviceCode` → always succeeds.

### 4.2 Projects — 4 procedures

```ts
await client.projects.create({ slug: "acme", name: "Acme" });
//   → Project | throws ProjectSlugConflictError
await client.projects.list();
//   → ReadonlyArray<Project>
await client.projects.getBySlug({ slug: "acme" });
//   → Project | throws ProjectNotFoundError
await client.projects.delete({ projectId });
//   → void | throws ProjectNotFoundError
```

`Project` wire shape (`@gmacko/contracts/schemas/projects`):
`{ id, tenantId, slug, name, createdAt, updatedAt }`. Timestamps decode
as JS `Date`.

**Stub data** (`packages/contracts/src/stubs/projects.ts`):

- `list` → 2 projects: `{slug: "acme", name: "Acme"}` and
  `{slug: "oodadocs", name: "OODA Docs"}`.
- `getBySlug` → resolves either of the above; anything else raises
  `ProjectNotFoundError`.
- `create` → returns a project with fixed id
  `"99999999-9999-9999-9999-999999999999"` echoing your slug/name.
- `delete` → success for any of the 3 known ids; else
  `ProjectNotFoundError`.

### 4.3 Secrets — 6 procedures

```ts
await client.secrets.create({
  name: "OPENAI_API_KEY",
  plaintext: "sk-...",
  policy: { allowedTemplates: ["openai/chat"], maxUses: 100 },
  usesRemaining: 100,
});
//   → SecretEnvelope | throws SecretNameConflictError

await client.secrets.list();
//   → ReadonlyArray<SecretEnvelope>    — no plaintext, no ciphertext

await client.secrets.getEnvelope({ secretId });
//   → SecretEnvelope | throws SecretNotFoundError

// decryptForUse is the ONLY procedure that returns plaintext.
// Consume once and discard — do not cache.
await client.secrets.decryptForUse({
  secretId,
  templateId: "openai/chat",     // optional, for policy-scoped access
  args: ["--model", "gpt-4"],    // optional, for arg-prefix policy
});
//   → { plaintext, envelope }
//   | throws SecretNotFoundError | PolicyDeniedError | MaxUsesExceededError

await client.secrets.markUsed({ secretId, templateId, commandPrefix, success });
//   → void | throws SecretNotFoundError

await client.secrets.delete({ secretId });
//   → void | throws SecretNotFoundError
```

`SecretEnvelope` wire shape: `{ id, tenantId, name, policy,
usesRemaining, createdAt, updatedAt }`. **Never** contains `plaintext`,
`ciphertext`, `iv`, or `authTag`.

**Stub data** (`packages/contracts/src/stubs/secrets.ts`):

- `list` → 2 envelopes: `"GITHUB_TOKEN"` (unrestricted) and
  `"OPENAI_API_KEY"` (policy: `allowedTemplates: ["openai/chat"],
  maxUses: 100`).
- `decryptForUse` → returns `"stub-plaintext-value-1"` or
  `"stub-plaintext-value-2"` depending on which stub secret id.
- `create` with `name === "CONFLICT_DEMO"` → raises
  `SecretNameConflictError` so the error path is exercisable.

### 4.4 Agent — 5 procedures (1 streaming)

```ts
// Non-streaming
await client.agent.createSession({
  adapterId: "claude-code",
  title: "Debug the flaky test",  // optional
  systemPrompt: "...",             // optional
  allowedTools: ["read", "edit"],  // optional
  cwd: "/Volumes/dev/ooda",        // optional
});
//   → { conversationId, status: "pending" }

await client.agent.cancelSession({ conversationId });
//   → void | throws AgentSessionNotFoundError
await client.agent.closeSession({ conversationId });
//   → void | throws AgentSessionNotFoundError
await client.agent.getTranscript({ conversationId });
//   → { conversation: ChatConversation, messages: ReadonlyArray<ChatMessage> }
//   | throws AgentSessionNotFoundError
```

#### Streaming: `agent.sendTurn`

Returns an `AsyncIterable<AgentEventWire>`. Consume with `for await`:

```ts
for await (const evt of client.agent.sendTurn({
  conversationId,
  prompt: "what did I do last week?",
})) {
  switch (evt.type) {
    case "session_init":
      // evt.externalSessionId, evt.model — first event on a fresh session
      break;
    case "turn_start":
      break;
    case "text_delta":
      // Append evt.text to the UI buffer for this turn.
      appendToChat(evt.text);
      break;
    case "tool_use":
      // evt.id, evt.name, evt.input — Claude requested a tool call
      break;
    case "tool_result":
      // evt.toolUseId, evt.content, evt.isError
      break;
    case "turn_end":
      // evt.stopReason — turn is done
      break;
    case "canceled":
      break;
  }
}
```

`AgentEventWire` is the tagged union defined in
`@gmacko/contracts/schemas/agent`. Seven variants total:
`session_init | turn_start | text_delta | tool_use | tool_result |
turn_end | canceled`.

**Stub behaviour** (`packages/contracts/src/stubs/agent.ts`): for the
fixed `conversationId`
`"cccccccc-cccc-cccc-cccc-cccccccccccc"`, `sendTurn` emits exactly 3
events — `session_init`, `text_delta` with text `"you said: <prompt>"`,
and `turn_end`. Any other `conversationId` errors with
`AgentSessionNotFoundError`.

**Streaming-transport caveat.** Effect 4's `RpcServer.layerHttp` with
`RpcSerialization.layerJson` buffers the full stream server-side and
returns it as one JSON array in a single response body. So in 6F the
client receives all events when the turn *ends*, not incrementally. For
typical chat UIs this is usually fine; for strict progressive rendering
you'll need NDJSON / chunked streaming, which lands in 6K by switching
both sides to `RpcSerialization.layerNdjson`. The *client-side* consumer
code in this guide does not change when that switch happens — you still
`for await` over the same `AsyncIterable`.

---

## 5. Tagged errors

RPC failures reject the returned Promise (or throw from the
`AsyncIterable`) with an instance of the tagged error class from the
source package (`@gmacko/auth`, `@gmacko/projects`, `@gmacko/secrets`,
`@gmacko/agent`).

**Reality check**: the thrown error is the *decoded* shape reconstructed
on the client. Its `_tag` and payload properties are the stable contract;
`instanceof SomeErrorClass` does **not** reliably hold because the
decoder produces a fresh structural object, not an instance of the
original class. **Pattern-match on `_tag`** instead:

```ts
import type { ProjectSlugConflictError } from "@gmacko/projects";

try {
  await client.projects.create({ slug: "acme", name: "Acme" });
} catch (err) {
  const tagged = err as { readonly _tag?: string };
  if (tagged._tag === "ProjectSlugConflictError") {
    // Safe to read payload props declared on that class:
    const detail = err as ProjectSlugConflictError;
    showError(`Slug '${detail.slug}' is already taken`);
    return;
  }
  throw err;
}
```

Transport-level failures (server 500, network error, schema decode
failure) surface as `RpcClientError` instances from
`effect/unstable/rpc`. Treat any `_tag` you don't recognize as
"unexpected, rethrow or log."

**Tagged error classes you'll encounter in 6F:**

| Procedure(s)                      | Error `_tag`                |
| --------------------------------- | --------------------------- |
| `auth.resolveTenant`              | `TenantNotSelectedError`    |
| `auth.revokeApiKey`               | `InvalidApiKeyError`        |
| `auth.pollDeviceCode`             | `InvalidDeviceCodeError`    |
| `auth.approveDeviceCode`          | `InvalidUserCodeError` \| `AlreadyApprovedError` |
| `projects.create`                 | `ProjectSlugConflictError`  |
| `projects.getBySlug` / `.delete`  | `ProjectNotFoundError`      |
| `secrets.create`                  | `SecretNameConflictError`   |
| `secrets.*` (read/use/delete)     | `SecretNotFoundError`       |
| `secrets.decryptForUse`           | `PolicyDeniedError` \| `MaxUsesExceededError` |
| `agent.*` (except `createSession`)| `AgentSessionNotFoundError` |
| `agent.sendTurn` (stream errors)  | `TurnInProgressError` \| `AdapterSpawnError` \| `AdapterExitError` |

All are re-exported from their source packages; import directly from
`@gmacko/auth`, `@gmacko/projects`, `@gmacko/secrets`, `@gmacko/agent`
if you need the class for type assertions.

---

## 6. Stub vs real — migration roadmap

### 6F: stubs (shipping now)

| Group     | Procedures                                                                             |
| --------- | -------------------------------------------------------------------------------------- |
| Auth      | all 9 stubbed — fixed user, 1 membership, 1 API key, device-flow always "pending"      |
| Projects  | all 4 stubbed — 2 fixtures returned by `list`/`getBySlug`, `create` echoes input       |
| Secrets   | all 6 stubbed — 2 fixture envelopes, `decryptForUse` returns fixed `stub-plaintext-*`  |
| Agent     | all 5 stubbed — `sendTurn` emits 3 fixed events for the one known conversationId       |

Every stub is deterministic (fixed UUIDs, fixed timestamps). Writing
golden-style tests against them is safe.

### 6K: real handlers (upcoming, same contracts)

| Group     | Real impl in 6K                                                                              |
| --------- | --------------------------------------------------------------------------------------------- |
| Auth      | better-auth sessions + DB-backed API keys + real device flow (`@gmacko/auth` services)        |
| Projects  | DB-backed CRUD against `projects` table (`@gmacko/projects` service, tenant-scoped)           |
| Secrets   | AES-GCM envelope encryption via `@gmacko/secrets::Crypt` + policy + usage counters            |
| Agent     | `@gmacko/agent::AgentSession` + Claude-Code subprocess adapter + DB-backed transcript persist |

**Schema shapes are frozen.** The wire contracts in
`@gmacko/contracts/schemas/*` won't change across the stub→real swap;
OODA's calling code survives the transition unchanged.

---

## 7. Migrating from legacy OODA procedures

OODA's existing RPC surface lives in `packages/contracts/src/rpc.ts` —
`GmackoRpcGroup` composes these 17 procedures:

- `threads.list | threads.byId | threads.create | threads.updateStatus`
- `branches.listByThread | branches.create | branches.setActive`
- `messages.listByBranch | messages.create`
- `agent.chat` (non-streaming — distinct from the new `agent.*` surface)
- `wiki.synthesize | wiki.list | wiki.orphans`
- `exploration.start | exploration.respond | exploration.status | exploration.list`

These **stay in `@gmacko/contracts`** as OODA-compat surface. They are
**not** wrapped by `@gmacko/client`, which only facades the four new
gmacko-shared groups (`AuthRpc`, `ProjectsRpc`, `SecretsRpc`, `AgentRpc`).

If you need to call legacy procedures from a new browser client, call
`RpcClient.make(GmackoRpcGroup)` directly via a small Effect bootstrap
— or wait until OODA's UI flows migrate to the new `agent.*` surface.

**Incremental migration path:**

1. **Short term.** Keep using `threads.*` / `branches.*` / `messages.*`
   where the existing thread+branch+message data model fits. No forced
   migration — both surfaces coexist.
2. **Medium term.** Migrate chat flows to `agent.createSession` +
   `agent.sendTurn` + `agent.getTranscript`. The new surface is
   streaming-native, adapter-pluggable (claude-code today, others
   later), and persists through the shared gmacko `chat_conversations`
   / `chat_messages` tables.
3. **Longer term.** Retire legacy procedures as they become unused.
   Exploration + wiki surfaces stay OODA-owned — they don't have
   gmacko-shared equivalents.

No timeline is attached to these phases; migrate as product shape
converges.

---

## 8. Known caveats

Drift findings carried from Tasks 2-9 of Phase 6F:

- **Streaming buffers to JSON array.** Per §4.4, `agent.sendTurn` events
  arrive all-at-once when the turn ends under JSON serialization. True
  chunked streaming requires NDJSON on both ends; swap lands in 6K. The
  consumer-side `for await` pattern does not change.
- **`instanceof` doesn't work on thrown errors.** The RPC decoder
  produces fresh structural objects, not instances of the original
  tagged-error classes. Pattern-match on `_tag` (§5).
- **Per-request auth headers** flow via
  `createGmackoRpcClient({ headers })` — under the hood that hits
  `RpcClient.layerProtocolHttp`'s `transformClient` hook. The server-
  side extracts credentials via the `AuthMiddleware` (6C carryover,
  wrapped in `RpcMiddleware.Service` in Phase 6F Task 2). Cookie jar
  handling in the browser is not wired in the client — rely on the
  browser's native cookie handling for session cookies, and pass
  explicit `Authorization` headers for API keys.
- **Stubs use fixed v4 UUIDs.** If you write golden tests,
  `"11111111-1111-1111-1111-111111111111"` (project 1),
  `"22222222-2222-2222-2222-222222222222"` (project 2),
  `"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"` / `"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"`
  (secrets), and `"cccccccc-cccc-cccc-cccc-cccccccccccc"` (conversation)
  are the canonical fixture ids.
- **Per-call RpcClient.** The client SDK scopes a fresh `RpcClient`
  inside each facade call. The transport Layer is built once in
  `createGmackoRpcClient`, so there's no per-call connection setup cost
  beyond the underlying `fetch` — but there's also no long-lived
  subscription state. This simplifies cancellation but means any future
  long-lived stream work will need a scope-across-iteration runtime
  (tracked for 6G/6K).

---

## 9. What's NOT in 6F (deferred to 6K or later)

- **Real service-backed handlers.** Auth currently returns a fixed
  stub user; Projects returns 2 fixture rows; Secrets' plaintext is
  literal `"stub-plaintext-value-N"`; Agent emits 3 mock events per
  turn. All of these swap to real implementations in 6K.
- **True SSE / chunked streaming transport.** JSON-array buffering
  works for 6F. NDJSON switch lands in 6K.
- **Real auth cookie / header bootstrapping.** The client accepts a
  `headers` option today, but there's no scaffolded helper for
  extracting a better-auth session cookie in OODA's browser context.
  Supply headers yourself until 6K ships a helper.
- **`apps/web` as the hosted RPC endpoint.** The Next.js route handler
  that composes real Layers lands in 6K. Until then, OODA must spin
  up the stub server (§3).
- **Legacy OODA procedures are NOT wrapped by `@gmacko/client`.** Use
  `RpcClient.make(GmackoRpcGroup)` directly if you need `threads.*` /
  `branches.*` / `messages.*` / `exploration.*` / `wiki.*` from a new
  browser client. No migration pressure — both surfaces coexist.
- **Tree-shakeable per-group clients.** `makeAuthClient`,
  `makeProjectsClient`, `makeSecretsClient`, `makeAgentClient` are
  exported from `@gmacko/client` for consumers who only want one
  group, but bundler tree-shaking verification is deferred to when
  OODA's bundle reports surface real sizes.

---

## References

- `packages/client/src/index.ts` — `createGmackoRpcClient` entry point.
- `packages/client/src/{auth,projects,secrets,agent}.ts` — per-group
  facades with full TS signatures.
- `packages/client/src/__tests__/e2e.test.ts` — working stub-server +
  client round-trip; copy the composition pattern verbatim.
- `packages/contracts/src/groups/*.ts` — `Rpc.make` / `RpcGroup.make`
  declarations for every procedure, with payload / success / error
  schemas.
- `packages/contracts/src/schemas/*.ts` — wire-format types.
- `packages/contracts/src/stubs/*.ts` — deterministic mock handlers
  and fixture IDs.
- `docs/plans/2026-04-21-phase6f-contracts.md` — the 6F plan, with the
  task-by-task history and design decisions.
- `docs/plans/2026-04-19-phase6-core-finalization.md` — the master
  plan, including the 6K section that covers when stubs get swapped
  for real handlers.

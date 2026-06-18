# gmacko Core Finalization — Design

**Date:** 2026-04-19
**Status:** Design approved via brainstorming session. Implementation plan TBD.
**Goal:** Define the scope, shape, and package inventory of "finalized gmacko core" so that Bob can be migrated onto it, followed by OODA. Research folds into OODA after.

---

## 1. Context

gmacko is the shared monorepo for two products — **Bob** (agent + work-item management, ForgeGraph integration) and **OODA** (research → git-backed Obsidian vault wiki as poor-man's RAG). The `/Volumes/dev/research` repo will be folded into OODA. gmacko will eventually become the gmacko fork of t3code.

This document defines what "finalized" means and locks in the architectural decisions needed before Bob migration can begin.

---

## 2. Key Decisions

### 2.1 Finalization bar: feature-parity with current Bob needs
Every capability Bob uses today that OODA will also need (today or plausibly soon) must have a working equivalent in gmacko before Bob migration begins. The litmus test for "should this live in gmacko core?" is: **OODA will also need it.**

### 2.2 Stack: Effect-RPC is canonical
Bob and OODA are both currently tRPC; both will be migrated onto Effect-RPC as part of joining gmacko. No adapter shims, no dual-track. gmacko shared packages expose Effect RPC groups, Effect services, Effect/Schema contracts.

### 2.3 Migration sequence
1. **Finalize gmacko core** (this document's scope)
2. **Migrate Bob** onto gmacko core — Bob's stack rewrite happens here
3. **Migrate OODA** onto finalized gmacko core — only after Bob is done
4. **Fold Research into OODA** — research-backend Python sidecar stays Python but becomes an OODA-owned package

### 2.4 Git backing: Cloudflare Artifacts (deferred, design-for-now)
All git-repo management — OODA vault repos, ForgeGraph app repos — will target **Cloudflare Artifacts**. Implementation is deferred to a later session. For now: assume simple local/remote git, but **design all git-touching surfaces behind abstractions** so the Artifacts backend swap is a later concern, not an API change.

### 2.5 Realtime: SSE + pluggable pubsub (no Pusher)
- **SSE for server→client streaming** (agent tokens, runner events) — already in gmacko, keep it
- **`@gmacko/realtime` pubsub abstraction** for cross-session fan-out with pluggable backends:
  - `@gmacko/ws-gateway` — first-class self-hosted backend (lifted from Bob's `apps/ws-gateway`)
  - Redis — production pubsub
  - In-memory — dev/test
- **No Pusher.** Vendor dependency and cost are not acceptable. Bob's current Pusher usage gets replaced during migration.

### 2.6 App shell: per-product apps, shared shell packages
- gmacko ships `@gmacko/app-shell` (web), `@gmacko/mobile-shell`, and a desktop shell
- Each product has its own `apps/{bob,ooda}-{web,mobile,desktop}` composing the shell + product features
- gmacko's current `apps/web` becomes the **reference/dev harness** for the web shell — NOT a production app
- gmacko's current `apps/server` is **dropped** — the Effect-RPC server lives inside the Next.js app (same pattern OODA uses today)
- **Electron desktop is gmacko core** — both products will have a desktop app

### 2.7 UI theming: gmacko owns the mechanism + reference themes; products can override
- gmacko owns the theme mechanism (`data-theme` attribute on root, CSS custom-property contract, theme-aware components in `@gmacko/ui`)
- gmacko ships **two reference themes** — Bob (amber/warm-gray/Industrial, lifted from Bob's DESIGN.md) and OODA (dark + gold)
- Products can override by shipping their own `@{bob,ooda}/theme` package
- **Fix needed:** existing CLAUDE.md calls Bob "purple/indigo" — wrong; Bob is amber (#D4850A) per its real DESIGN.md. Correct when theme work lands.

---

## 3. Package Inventory

### 3.1 Gmacko core (23 packages)

Packages that both products need — they live in `/Volumes/dev/gmacko/packages/`.

| Package | Role |
|---|---|
| `@gmacko/auth` | better-auth wrapped as Effect `Service` with `CurrentUser` context tag; tenancy baked in (`tenants`, `tenant_members`); GitHub OAuth + device flow for mobile/desktop |
| `@gmacko/secrets` | Session-scoped encrypted credential broker (not a KV): envelope encryption (master key + HMAC-derived per-secret keys), policy-gated usage (`allowedTemplates`, `allowedArgPrefixes`, `maxUses`, `redactOutput`), audit trail (`session_secret_usages`), MCP tool surface for agent consumption, CLI-auth-status probes (is `codex`/`claude`/`gh` authed?), ForgeGraph secret-push adapter |
| `@gmacko/db` | Drizzle schema definitions for shared tables (see §4.3); dual-driver PGlite (dev) / Postgres (prod); `@gmacko/db/schema/*` exports consumed by products |
| `@gmacko/agent` | **Session primitive**: a conversation with a tool-using agent. Owns streaming, tool-use dispatch, transcript persistence, cancellation. Not a DAG orchestrator. |
| `@gmacko/agent-toolkit` | Skill / workflow / tool plumbing that wraps the session primitive. Bob-specific tools (work-item helpers, ForgeGraph actions) live in Bob; OODA-specific tools live in OODA. |
| `@gmacko/rpc` | Effect-RPC plumbing: framework shell, RPC group conventions, error types, middleware, context injection. Does NOT include product RPC groups. |
| `@gmacko/realtime` | Pubsub abstraction with pluggable backends (ws-gateway, Redis, in-memory); SSE helpers for server→client streams |
| `@gmacko/ws-gateway` | Self-hosted WebSocket gateway (lifted from Bob's `apps/ws-gateway`) — one of the pubsub backends |
| `@gmacko/runner-protocol` | Effect/Schema wire contract for runner lifecycle: Register, Heartbeat, ClaimWork, ReportEvent, Capabilities |
| `@gmacko/runner-base` | Shared Effect runtime that implements the protocol; products extend with domain-specific work handlers. Starts from Bob's task-run model; OODA's session model layers onto the same workflow. |
| `@gmacko/notifications` | Email / push / in-app notifications (shared across products) |
| `@gmacko/storage` | File upload / artifact storage abstraction |
| `@gmacko/monitoring` | Sentry / logging / metrics |
| `@gmacko/mcp-server` | MCP tool exposure for Claude integration |
| `@gmacko/email` | Transactional email (Resend/SendGrid abstraction) |
| `@gmacko/cookies` | Cookie handling (auth-adjacent) |
| `@gmacko/config` | Env/config loading with Effect/Schema validation |
| `@gmacko/validators` | Shared Schema validators |
| `@gmacko/i18n` | Localization |
| `@gmacko/settings` | User settings shell — UI + API; product-specific settings layer on top |
| `@gmacko/analytics` | Product analytics |
| `@gmacko/billing` | Stripe-backed billing (rolls up Bob's `payments` + `purchases`); products define their own plans/SKUs on top |
| `@gmacko/ui` | Component library + theme mechanism + reference Bob & OODA themes |
| `@gmacko/app-shell` | Common web routes/layouts/auth UI/provider stack (Next.js) |
| `@gmacko/mobile-shell` | Shared Expo shell |
| `@gmacko/desktop-shell` | Shared Electron shell |

### 3.2 Bob-specific (stay in `/Volumes/dev/bob`)

| Package | Why it stays |
|---|---|
| `@bob/work-items` | Core Bob domain model (hierarchical issues + artifacts + comments). Product-defining. |
| `@bob/bob` | Bob provisioning scripts |
| `@bob/api-forgegraph` | ForgeGraph sync services (`api/services/forgegraph`, `api/services/git/providerConnectionService.ts`) |
| `@bob/theme` (optional) | Bob-specific theme overrides if they diverge from gmacko's reference |
| `@bob/legacy` | Dead code — leave alone, migrate nothing |

### 3.3 OODA-specific (stay in / move to `/Volumes/dev/ooda`)

| Package | Notes |
|---|---|
| `@ooda/thread-model` | Thread state machines, slug resolution |
| `@ooda/thread-workspace` | File I/O for threads (git-backed Obsidian vaults) |
| `@ooda/vault` | Git-backed vault operations — **must sit behind an abstraction for the future Cloudflare Artifacts swap** |
| `@ooda/domain-packs` | Templates for new research threads |
| `@ooda/provenance` | Content-hash artifact IDs, lineage, `[UNVERIFIED]` markers |
| `@ooda/imports` | Ingestion pipeline (sources → vault files) |
| `@ooda/capability-registry` | Capabilities advertised by runners |
| `@ooda/source-connectors` | Pluggable search providers (Semantic Scholar, OpenAlex, ERIC, PsyArxiv, etc.) |
| `@ooda/research-backend` | Python FastAPI sidecar (folded from `/Volumes/dev/research`; stays Python) |
| `@ooda/wiki` | **Moved OUT of gmacko core** — Bob doesn't need wiki/vault. The current `packages/wiki` skeleton in gmacko gets relocated to OODA during migration. |
| `@ooda/theme` (optional) | OODA-specific theme overrides |

---

## 4. Per-Package Design Sketches

### 4.1 `@gmacko/auth`

- Wraps `better-auth` behind an Effect `Service` with a `CurrentUser` context tag
- Tenancy is part of the core user model: `tenants`, `tenant_members` tables with role-based access
- Exposes GitHub OAuth + device flow (for mobile/desktop where browser OAuth is awkward)
- Every RPC handler gets `CurrentUser` injected via the Effect context; authorization is explicit, not implicit
- Schema exports: `users`, `sessions`, `accounts`, `verifications`, `tenants`, `tenant_members`

### 4.2 `@gmacko/secrets`

- **Not** a generic KV store — a capability-gated credential broker for agent sessions
- Envelope encryption: master key from `GMACKO_SECRET_ENCRYPTION_KEY` (rename from Bob's `GIT_TOKEN_ENCRYPTION_KEY`); per-secret rowkey = HMAC-SHA256(masterKey, `"session-secret:" + secretId`)
- Stored values: AES-256-GCM ciphertext + IV + tag
- Usage policies per secret: `allowedTemplates`, `redactOutput`, `maxUses`, `templatePolicies.allowedArgPrefixes`
- Agents consume secrets via the MCP tool — they don't get raw values directly; they inject them into allowlisted commands
- CLI-auth-status probes: `checkCodexAuth()`, `checkClaudeAuth()`, `checkGhAuth()`, etc. — run before dispatching work so the runner can signal "this device isn't set up" instead of failing mid-session
- Schema exports: `session_secrets`, `session_secret_usages`, `project_deploy_secret_bindings`

### 4.3 `@gmacko/db` schema scope

**Gmacko-owned tables:**
- Auth: `users`, `sessions`, `accounts`, `verifications`, `tenants`, `tenant_members`
- Secrets: `session_secrets`, `session_secret_usages`, `project_deploy_secret_bindings`
- Agent sessions: `chat_conversations`, `chat_messages` (the transcript is owned by the session primitive)
- Runner: `task_runs`, `task_run_events`, `runner_devices`, `runner_capabilities`

**Product-owned tables:**
- Bob: `work_items`, `artifacts`, `comments`, `activities`, `projects`, `forge_revisions`
- OODA: `research_threads`, `provenance_events`, `vault_taxonomy`, `sources`, `source_connectors`

**Migration strategy (locked):** per-product migrations over a shared schema. Each product runs its own `drizzle-kit` against a combined schema (gmacko imports + own domain tables) with its own migration history. No single global migration set; no physical DB split.

### 4.4 `@gmacko/agent` — session primitive

A **session** is:
- One conversation with a tool-using agent (Claude API or Codex CLI as the first two adapters)
- Streamed events: tokens, tool calls, tool results, usage metadata
- Persisted transcript via `chat_conversations` + `chat_messages`
- Cancellable — session can be aborted from either end
- Transport-agnostic: consumed over SSE in the web client, over the runner event stream in a runner context

A session is **NOT**:
- A scheduling primitive (products own outer scheduling via `@gmacko/runner-*`)
- A workflow / DAG engine (products compose sessions into their own workflows)
- Tied to any specific domain shape (work-items, threads, wikis — those are all product concerns)

### 4.5 `@gmacko/runner-protocol` + `@gmacko/runner-base`

**Protocol** (Effect/Schema wire contract):
- `Register(device_id, capabilities, auth_token)` — runner registers with API on startup
- `Heartbeat(device_id, status)` — keepalive
- `ClaimWork(device_id, capabilities_filter)` — runner pulls available work
- `ReportEvent(run_id, event)` — runner streams events back
- `Capabilities` — advertised capabilities (can_codex, can_claude, has_vault_write, etc.)

**Base runtime**: shared Effect layer that handles lifecycle, retries, cancellation, event replay, backpressure. Products extend by registering domain-specific `WorkHandler`s.

Starting point: Bob's `apps/execution` task-run model. OODA's runner-session model will layer onto the same workflow during the OODA migration.

### 4.6 `@gmacko/realtime`

Two concerns, one package:

**SSE helpers** — for server→client token/event streams. Effect-RPC-native, leverages existing gmacko SSE support.

**Pubsub abstraction** — for cross-session fan-out (notifications, presence, activity feeds):

```
interface PubSub {
  publish(channel: string, event: unknown): Effect<void, PubSubError>
  subscribe(channel: string): Stream<Event, PubSubError>
}
```

Three backends ship in core:
- `@gmacko/realtime/backends/ws-gateway` — uses `@gmacko/ws-gateway`
- `@gmacko/realtime/backends/redis` — Redis pub/sub for prod
- `@gmacko/realtime/backends/memory` — dev/test

Selection via config. No Pusher.

### 4.7 Git abstraction (for future Cloudflare Artifacts)

Every git-touching surface goes through an interface so the future Artifacts backend is a single-place swap:

```
interface GitRepo {
  clone(url: string, dest: string): Effect<void, GitError>
  pull(): Effect<void, GitError>
  commit(message: string, files: string[]): Effect<Sha, GitError>
  push(): Effect<void, GitError>
  // etc.
}
```

Current implementations: simple-git wrapper (dev), basic remote (GitHub/Gitea). Future: Cloudflare Artifacts API.

This affects `@ooda/vault`, `@ooda/wiki`, `@bob/api-forgegraph` — all must consume the abstraction, not call git directly.

---

## 5. What Gets Dropped from gmacko

- `apps/server` — Effect-RPC server lives inside the Next.js app instead
- `packages/wiki` — moves to `@ooda/wiki` (Bob doesn't need it)
- The "purple/indigo" placeholder for the Bob theme in existing CLAUDE.md — replaced with amber (#D4850A) per Bob's real DESIGN.md

---

## 6. Deferrals — explicitly out of scope for this finalization

| Topic | Why deferred |
|---|---|
| Cloudflare Artifacts integration | Separate design session planned; design abstractions now so swap is painless later |
| OODA migration onto gmacko | Blocked on Bob migration being complete |
| Research → OODA fold-in | Post-OODA-migration |
| Fixing the CLAUDE.md "purple/indigo" wording | Trivial; happens when the theme work lands |

---

## 7. Success Criteria

Finalization is "done" when:

1. All 26 core packages exist in `/Volumes/dev/gmacko/packages/` with stable public APIs
2. gmacko's reference `apps/web` (+ mobile, desktop) runs end-to-end using only gmacko core packages:
   - User logs in (better-auth via `@gmacko/auth`)
   - User creates an agent session (via `@gmacko/agent`)
   - Session streams a response (SSE via `@gmacko/realtime`)
   - A runner picks up and executes a task-run (via `@gmacko/runner-*`)
   - Secrets can be provisioned and consumed by the runner (via `@gmacko/secrets`)
   - Transcript persists to DB and is queryable
3. Bob theme renders correctly under `data-theme="bob"` in the reference web app
4. `@gmacko/db` migrations apply cleanly to a fresh Postgres
5. Tests pass for all core packages

Once these hit, Bob migration can begin.

---

## 8. Open Items for Follow-up Sessions

- Cloudflare Artifacts design session (git-repo management across OODA vault + ForgeGraph)
- Detailed implementation plan for this finalization (what to build first, dependency order, checkpoint structure) — can be driven by `superpowers:writing-plans`
- OODA migration design (post-Bob)
- Research → OODA fold design
- Theme design consultation for OODA (Bob theme is already specified; OODA is "dark + gold" placeholder)

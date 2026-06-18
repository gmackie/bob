# Bob + OODA Deployment & OpenAPI Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Bob and OODA as production apps at bob.blder.bot and ooda.blder.bot, with OpenAPI specs enabling typed client generation and cross-app integration.

**Architecture:** Three-tier deployment — CF Workers (web + API), labnuc (agent runtime), Hetzner (database + WS gateway). Both apps expose tRPC + REST (via trpc-openapi) + OpenAPI spec.

---

## Architecture

### CF Workers (Web + API)

- `bob.blder.bot` — Bob's Vinext app (already deployed, needs subdomain routing)
- `ooda.blder.bot` — OODA ported from Next.js to Vinext (new CF Workers project)
- Both serve tRPC + REST endpoints (via trpc-openapi) + OpenAPI spec at `/openapi.json`
- Both use Hyperdrive → Hetzner Postgres

### labnuc (Agent Runtime)

- Unified runner process (initially separate Bob + OODA runners, converge later)
- Python research sidecar (FastAPI, already has Dockerfile)
- Podman pod with shared networking, systemd services, ForgeGraph-managed
- Outbound connections to WS gateway + CF Workers APIs

### Hetzner (Infrastructure)

- Postgres database (Bob + OODA)
- Shared WebSocket gateway at ws.blder.bot (hetzner-master:3003)
- ForgeGraph edge proxy

### Communication Flow

```
Users → bob.blder.bot (CF Workers) → Hyperdrive → Hetzner Postgres
Users → ooda.blder.bot (CF Workers) → Hyperdrive → Hetzner Postgres
Runner (labnuc) ↔ WS gateway (Hetzner) ↔ CF Workers
Runner (labnuc) → research sidecar (labnuc, localhost:8000)
```

---

## Phasing

### Phase 1: OpenAPI Specs (this phase)

- Add trpc-openapi to OODA tRPC router (68 procedures)
- Add trpc-openapi to Bob tRPC router (~200+ procedures)
- Serve specs at `/openapi.json`
- Generate typed clients (`@gmacko/ooda-client`, `@gmacko/bob-client`)
- Research sidecar already has native OpenAPI

### Phase 2: OODA Vinext Port

- Port OODA web app from Next.js to Vinext
- Add wrangler.jsonc with Hyperdrive binding
- Deploy to CF Workers at ooda.blder.bot
- Swap PGlite to Hyperdrive/Postgres for production

### Phase 3: Runner Containerization

- Create apps/ooda-runner/Dockerfile
- Podman pod spec (runner + research sidecar)
- ForgeGraph deployment to labnuc
- Wire runner to WS gateway + both APIs

### Phase 4: Runner Unification

- Merge Bob + OODA runner into single agent process
- Shared adapter registry, shared WS gateway connection
- Single container, dual API registration

---

## OpenAPI Design (Phase 1 Detail)

### trpc-openapi Integration

Both routers use `trpc-openapi` to annotate procedures with OpenAPI metadata:

```typescript
// Example: OODA threads.list
list: publicProcedure
  .meta({ openapi: { method: 'GET', path: '/api/threads', tags: ['threads'] } })
  .input(...)
  .query(...)
```

**Convention:**
- Queries → GET, Mutations → POST
- Path: `/api/{router}/{action}` or `/api/{router}/{:id}/{action}`
- Tags match router names: threads, runner, vault, research.kb, research.dives, etc.

### OpenAPI Spec Serving

Each app exposes:
- `/openapi.json` — machine-readable spec
- `/docs` — Swagger UI (optional, dev only)

### Client Generation

Generated clients use `openapi-typescript` + `openapi-fetch`:

```typescript
// packages/ooda-client/src/index.ts (generated)
import createClient from 'openapi-fetch';
import type { paths } from './schema'; // generated from openapi.json

export const oodaClient = createClient<paths>({ baseUrl: 'https://ooda.blder.bot' });
```

### Procedure Inventory

**OODA (68 procedures across 6 routers):**
- threads (9): list, byId, bySlug, create, sync, updateStatus, listNotes, listDomainPacks, getDomainPackTemplate
- runner (14): register, heartbeat, listDevices, createSession, listSessions, listSessionsByRunner, sendPrompt, getSessionEvents, pushSessionEvent, claimSession, updateSessionStatus, getHealth, listAdapters, requestPromotion
- research (~37): kb.*, dives.*, memory.*, entities.*, papers.*, graph.*, tools.*, interests.*
- vault (6): list, read, write, promote, sync, health
- publish (2): draft, listDrafts
- imports (2): normalize, importConversations

**Bob (~200+ procedures across 35 routers):**
- activity, agentRun, artifact, auth, capture, chat, checkpoint, comment, cookies, dispatch, event, featureBranch, filesystem, forgegraph, git, gitProviders, instance, link, notification, plan, planning, planSession, project, publicApi, pullRequest, repository, requirement, secrets, session, settings, skill, snapshot, system, taskRun, terminal, webhook, workItem, workItems, workspace

### Research Sidecar (FastAPI)

Already generates OpenAPI natively at `/openapi.json`. No additional work needed. Spec covers: /api/health, /api/search, /api/kb/*, /api/chats/*, /api/embeddings/*, /api/extraction/*, /api/youtube/*, /api/dives/*.

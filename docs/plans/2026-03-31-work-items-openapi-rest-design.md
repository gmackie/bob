# Work Items OpenAPI REST Design

**Problem**

Bob's work-item APIs currently exist only as session-authenticated tRPC procedures. We need a publishable OpenAPI contract and a REST surface for downstream clients without splitting behavior across two implementations.

**Decision**

Keep tRPC as the canonical behavior layer. Add an RPC-shaped REST adapter that is intentionally 1:1 with the existing `workItems` procedure surface, and generate the OpenAPI document and REST route files from shared contract definitions.

**Why RPC-shaped REST**

The requirement is parity with the existing tRPC APIs, not a resource-pure redesign. Resource-style REST would force lossy translations from tRPC inputs into path params and query strings and would no longer be identical to the procedure contract. RPC-shaped REST preserves exact input objects, procedure naming, auth semantics, and error behavior.

**Scope**

Phase 1 covers the `workItems` router surface:

- `workItems.list`
- `workItems.get`
- `workItems.promoteToTask`
- `workItems.listComments`
- `workItems.createComment`
- `workItems.createArtifact`
- `workItems.listActivities`
- `workItems.listCurrentArtifacts`
- `workItems.listChildArtifactGroups`
- `workItems.listNotifications`
- `workItems.createNotification`
- `workItems.markNotificationAsRead`

Each operation will be exposed as `POST /api/v1/work-items/<operation-name>`.

**Contract Shape**

Each operation needs a shared definition with:

- procedure id, for example `workItems.list`
- REST path, for example `/api/v1/work-items/list`
- auth mode, initially `session`
- input Zod schema
- output Zod schema
- operation summary and tag metadata

The same input schemas should be used by the tRPC procedures themselves so validation does not drift. Output schemas should be explicit even where the current tRPC code relies on TypeScript inference from DB queries, because publishable OpenAPI requires an explicit wire contract.

**Generation Model**

The durable source of truth is the work-item contract registry in `@bob/api`, not hand-written REST route files. From that registry we generate:

1. OpenAPI paths and schema references for the work-item RPC endpoints
2. Thin Next.js route files under `apps/web/src/app/api/v1/work-items/*`

Generated route files should only:

- parse the JSON body
- create authenticated tRPC context
- invoke the mapped `appRouter` caller procedure
- normalize `TRPCError` to HTTP responses

Business logic remains inside the tRPC procedures.

**OpenAPI Publishing**

The existing `packages/api/src/openapi.ts` is only a placeholder and should be replaced with generated work-item paths. The published document should use OpenAPI 3.1 so we can derive schemas directly from Zod JSON Schema output with minimal impedance mismatch.

The web app should expose the generated document at a stable JSON endpoint such as `/api/openapi`.

**Testing**

Add tests that prove:

- the OpenAPI document includes expected work-item RPC paths and auth metadata
- generated REST routes call the correct tRPC procedures
- REST error handling matches existing `TRPCError` to HTTP conversion
- route generation remains in sync with the contract registry

**Tradeoffs**

- This is compatibility-oriented REST, not resource-oriented REST
- Explicit output schemas add some maintenance overhead
- Code generation introduces build-step discipline, but removes long-term route drift

**Non-goals**

- redesigning the work-item API into resource-style REST
- replacing tRPC as the primary internal server API
- generating tRPC from OpenAPI

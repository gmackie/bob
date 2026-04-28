// All tagged errors exposed by @gmacko/agent, hoisted to a dependency-free
// subpath so client bundles can import them via `@gmacko/agent/errors`
// without dragging in drizzle, @gmacko/db, or any node:* APIs.
//
// Why this exists: see docs/plans/2026-04-25-phase7a-punchlist.md Task 8.
//
// Parity rule: every TaggedErrorClass declared in service modules
// (agent-session.ts / adapter.ts) is mirrored here. The service modules
// re-export from this file, so a single import path (`@gmacko/agent`) still
// works for in-tree code while `@gmacko/contracts` and other client-bundle
// consumers import from `@gmacko/agent/errors`.
//
// IMPORTANT: this file MUST keep a single import — `effect/Schema` — so the
// subpath stays node:* / drizzle / @gmacko/db free.
import { Schema } from "effect";

// Branded ids (`TenantId`) are serialised as bare `Schema.String` to keep
// this module dependency-free; the brand is enforced at the service-method
// boundary so the tagged error doesn't need to re-run the brand decoder at
// construct time.
export class AgentSessionNotFoundError extends Schema.TaggedErrorClass<AgentSessionNotFoundError>()(
  "AgentSessionNotFoundError",
  { conversationId: Schema.String, tenantId: Schema.String },
) {}

export class TurnInProgressError extends Schema.TaggedErrorClass<TurnInProgressError>()(
  "TurnInProgressError",
  { conversationId: Schema.String },
) {}

export class AdapterSpawnError extends Schema.TaggedErrorClass<AdapterSpawnError>()(
  "AdapterSpawnError",
  { adapterId: Schema.String, message: Schema.String },
) {}

export class AdapterExitError extends Schema.TaggedErrorClass<AdapterExitError>()(
  "AdapterExitError",
  { adapterId: Schema.String, code: Schema.Number, stderr: Schema.String },
) {}

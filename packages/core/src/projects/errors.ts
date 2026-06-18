// All tagged errors exposed by @gmacko/projects, hoisted to a dependency-free
// subpath so client bundles can import them via `@gmacko/projects/errors`
// without dragging in drizzle, @gmacko/db, or any node:* APIs.
//
// Why this exists: see docs/plans/2026-04-25-phase7a-punchlist.md Task 7.
//
// Parity rule: every TaggedErrorClass declared in `projects.ts` is mirrored
// here. The service module re-exports from this file, so a single import
// path (`@gmacko/projects`) still works for in-tree code while
// `@gmacko/contracts` and other client-bundle consumers import from
// `@gmacko/projects/errors`.
//
// IMPORTANT: this file MUST keep a single import — `effect/Schema` — so the
// subpath stays node:* / drizzle / @gmacko/db free.
import { Schema } from "effect";

// Branded ids (`ProjectId`, `TenantId`) are serialised as bare `Schema.String`
// to keep this module dependency-free; the brand is enforced at the service-
// method boundary so the tagged error doesn't need to re-run the brand
// decoder at construct time.
export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  {
    tenantId: Schema.String,
    // `identifier` is the id OR slug used for the failed lookup — whichever
    // the caller supplied — so error messages can surface the right value
    // without the service having to branch.
    identifier: Schema.String,
  },
) {}

export class ProjectSlugConflictError extends Schema.TaggedErrorClass<ProjectSlugConflictError>()(
  "ProjectSlugConflictError",
  { tenantId: Schema.String, slug: Schema.String },
) {}

// @gmacko/projects — shared project primitive (Effect service + Layer).
//
// Public surface:
//   - `Projects` — Effect service with create/list/get/delete CRUD, tenant-scoped.
//   - `layerProjects` — Layer that requires `GmackoDb` from `@gmacko/db`.
//   - Tagged errors: `ProjectNotFoundError`, `ProjectSlugConflictError`.
//   - `Project` shape + `ProjectsShape` for consumers that need the contract type.

// Re-export the dependency-free tagged errors from `./errors`. Client
// bundles can also import these directly via `@gmacko/projects/errors` to
// avoid pulling in drizzle / @gmacko/db / node:crypto. See
// docs/plans/2026-04-25-phase7a-punchlist.md Task 7.
export * from "./errors.js";

export {
  Projects,
  layerProjects,
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "./projects.js";
export type { Project, ProjectsShape } from "./projects.js";

/** Package version/phase sentinel — kept for the Task 11 smoke test. */
export const __gmackoProjectsPhase = "6d" as const;

// @gmacko/projects — shared project primitive (Effect service + Layer).
//
// Public surface:
//   - `Projects` — Effect service with create/list/get/delete CRUD, tenant-scoped.
//   - `layerProjects` — Layer that requires `GmackoDb` from `@gmacko/db`.
//   - Tagged errors: `ProjectNotFoundError`, `ProjectSlugConflictError`.
//   - `Project` shape + `ProjectsShape` for consumers that need the contract type.

export {
  Projects,
  layerProjects,
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "./projects.js";
export type { Project, ProjectsShape } from "./projects.js";

/** Package version/phase sentinel — kept for the Task 11 smoke test. */
export const __gmackoProjectsPhase = "6d" as const;

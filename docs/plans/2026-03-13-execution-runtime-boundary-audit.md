# Execution Runtime Boundary Audit

This audit closes Phase 3.1 from the merge plan by separating long-running execution concerns from request/response product concerns.

## Must Live In `apps/execution`

- task launch orchestration that creates task runs, sessions, and initial prompts
- runtime session control for blocked, resumed, superseded, and restarted task runs
- gateway-facing session and git control requests used by long-running task execution
- planning control bridge logic that turns planning control requests into execution runtime actions
- runtime-only handoff message forwarding from planning issue updates into active Bob sessions

## Should Remain In Web/API Packages

- product UI routes, layouts, and task workspace rendering in `apps/web`
- request validation, webhook signature handling, and HTTP response shaping in `apps/web/src/app/api`
- tRPC request/response routers and shared product-domain queries in `packages/api`
- planning/work-item/product model persistence and schema definitions in `packages/db`
- request-time heuristics and auto-create helpers in `packages/api/src/services/tasks`
- MCP-facing user tools that read product/runtime state without owning orchestration loops

## Concrete Move In This Batch

- moved `taskExecutor` runtime orchestration from `apps/web/src/lib/tasks/taskExecutor.ts` to `apps/execution/src/runtime/taskExecutor.ts`
- moved `planningControl` runtime bridge logic from `apps/web/src/lib/tasks/planningControl.ts` to `apps/execution/src/runtime/planningControl.ts`
- retargeted web planning integration routes and webhook runtime hooks to import from `@bob/execution`

## Remaining Phase 3 Follow-Up

- move any additional polling or state-machine logic that still executes inside `apps/web` request handlers behind execution-owned entry points
- decide whether execution-owned control entry points should become dedicated internal APIs or queue consumers instead of direct in-process imports
- add broader execution-package coverage for session lifecycle orchestration and failure handling

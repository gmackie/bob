# Work Items OpenAPI REST Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a publishable OpenAPI contract and generated RPC-style REST adapter for the `workItems` tRPC APIs without duplicating work-item business logic.

**Architecture:** Extract shared work-item input and output schemas plus operation metadata into a contract registry in `@bob/api`. Generate an OpenAPI 3.1 document and thin Next.js REST route files from that registry. The generated handlers call the existing `appRouter` procedures through a server-side caller and reuse existing auth and error mapping.

**Tech Stack:** tRPC, Zod v4, OpenAPI 3.1, Next.js App Router route handlers, Vitest, `pnpm exec tsx`

### Task 1: Write the failing API contract tests

**Files:**
- Create: `packages/api/src/__tests__/work-items-openapi.test.ts`
- Read: `packages/api/src/openapi.ts`
- Read: `packages/api/src/router/workItems.ts`

**Step 1: Write the failing test**

Create tests that assert:

- `generateApiDocument()` includes `/api/v1/work-items/list`
- the operation uses `post`
- the operation is tagged `workItems`
- the operation declares cookie-based session auth
- the document includes `/api/v1/work-items/create-comment`

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/api/src/__tests__/work-items-openapi.test.ts`

Expected: FAIL because the current OpenAPI document is still a placeholder and does not contain the work-item RPC paths.

**Step 3: Commit**

```bash
git add packages/api/src/__tests__/work-items-openapi.test.ts
git commit -m "test(api): pin work item OpenAPI contract paths"
```

### Task 2: Write the failing REST route parity test

**Files:**
- Create: `apps/web/src/app/api/v1/work-items/list/__tests__/route.test.ts`
- Read: `apps/web/src/lib/rest/api-helpers.ts`

**Step 1: Write the failing test**

Create a route test that:

- mocks the authenticated caller factory
- posts JSON to the `work-items/list` route
- asserts `caller.workItems.list` receives the request body unchanged
- asserts the route returns the caller result as JSON

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/web vitest run src/app/api/v1/work-items/list/__tests__/route.test.ts`

Expected: FAIL because the generated route does not exist yet.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/v1/work-items/list/__tests__/route.test.ts
git commit -m "test(web): pin work item REST parity for list route"
```

### Task 3: Extract shared work-item contract definitions

**Files:**
- Create: `packages/api/src/contracts/work-items-rest.ts`
- Modify: `packages/api/src/router/workItems.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Define input schemas**

Move the work-item input Zod schemas into named exports such as:

- `listWorkItemsInputSchema`
- `getWorkItemInputSchema`
- `promoteToTaskInputSchema`
- `listCommentsInputSchema`
- `createCommentInputSchema`
- `createArtifactInputSchema`
- `listActivitiesInputSchema`
- `listCurrentArtifactsInputSchema`
- `listChildArtifactGroupsInputSchema`
- `listNotificationsInputSchema`
- `createNotificationInputSchema`
- `markNotificationAsReadInputSchema`

**Step 2: Define explicit output schemas**

Add explicit Zod output schemas for the wire responses used by the work-item APIs. Keep them broad only where the runtime really is open-ended, such as metadata blobs.

**Step 3: Add operation metadata**

Export an ordered `workItemsRestOperations` array with:

- `procedurePath`
- `restPath`
- `summary`
- `inputSchema`
- `outputSchema`
- `auth`

**Step 4: Update the router to reuse the extracted input schemas**

Replace inline inputs in `workItems.ts` with the shared schema exports so validation stays aligned.

**Step 5: Run focused tests**

Run: `pnpm vitest run packages/api/src/router/__tests__/work-items.test.ts`

Expected: PASS

### Task 4: Replace the placeholder OpenAPI document with generated work-item paths

**Files:**
- Modify: `packages/api/src/openapi.ts`
- Test: `packages/api/src/__tests__/work-items-openapi.test.ts`

**Step 1: Implement document generation from the contract registry**

Generate an OpenAPI 3.1 document with:

- title, version, description, and server URL config
- shared bearer auth security scheme
- one path item per work-item REST operation
- JSON request body schema derived from the Zod input schema
- success response schema derived from the Zod output schema

**Step 2: Run the OpenAPI test**

Run: `pnpm vitest run packages/api/src/__tests__/work-items-openapi.test.ts`

Expected: PASS

### Task 5: Add generator-backed REST route creation

**Files:**
- Create: `apps/web/src/lib/rest/work-item-route-handler.ts`
- Create: `scripts/generate-work-item-rest-routes.mjs`
- Create: `apps/web/src/app/api/v1/work-items/list/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/get/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/promote-to-task/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/list-comments/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/create-comment/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/create-artifact/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/list-activities/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/list-current-artifacts/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/list-child-artifact-groups/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/list-notifications/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/create-notification/route.ts`
- Create: `apps/web/src/app/api/v1/work-items/mark-notification-as-read/route.ts`
- Modify: `package.json`

**Step 1: Create a generic route factory**

Add a helper that accepts an operation metadata record and returns a `POST` handler that:

- reads `await request.json()`
- creates an authenticated caller via `createTRPCContext`
- invokes the correct `caller.workItems.<procedure>()`
- returns `NextResponse.json(result)`
- maps errors with the existing `errorResponse()`

**Step 2: Create the generator script**

Write a script that reads `workItemsRestOperations` and writes one `route.ts` file per operation using the generic route factory.

**Step 3: Generate the route files**

Run: `pnpm exec tsx scripts/generate-work-item-rest-routes.mjs`

Expected: the `apps/web/src/app/api/v1/work-items/*/route.ts` files are created or updated.

**Step 4: Add a root script**

Add a script such as `generate:work-item-rest` to the repo root `package.json`.

### Task 6: Make the first route test pass

**Files:**
- Test: `apps/web/src/app/api/v1/work-items/list/__tests__/route.test.ts`
- Modify: generated route files or route factory if needed

**Step 1: Run the first route test**

Run: `pnpm --filter @bob/web vitest run src/app/api/v1/work-items/list/__tests__/route.test.ts`

Expected: PASS

**Step 2: Add one failure-path assertion**

Extend the test to verify a thrown `TRPCError` becomes the correct HTTP status via `errorResponse`.

**Step 3: Re-run the route test**

Run: `pnpm --filter @bob/web vitest run src/app/api/v1/work-items/list/__tests__/route.test.ts`

Expected: PASS

### Task 7: Publish the OpenAPI document from the web app

**Files:**
- Create: `apps/web/src/app/api/openapi/route.ts`
- Read: `packages/api/src/openapi.ts`

**Step 1: Add the route**

Return the generated OpenAPI document as JSON with `content-type: application/json`.

**Step 2: Add a small route test if needed**

Assert the route returns `200` and contains `/api/v1/work-items/list`.

### Task 8: Run the full verification set

**Files:**
- Verify all touched files

**Step 1: Run package API tests**

Run: `pnpm vitest run packages/api/src/__tests__/work-items-openapi.test.ts packages/api/src/router/__tests__/work-items.test.ts`

Expected: PASS

**Step 2: Run web route tests**

Run: `pnpm --filter @bob/web vitest run src/app/api/v1/work-items/list/__tests__/route.test.ts`

Expected: PASS

**Step 3: Run typecheck**

Run: `pnpm turbo run typecheck -F @bob/api -F @bob/web`

Expected: PASS

**Step 4: Commit**

```bash
git add packages/api/src/contracts/work-items-rest.ts \
  packages/api/src/openapi.ts \
  packages/api/src/router/workItems.ts \
  packages/api/src/index.ts \
  packages/api/src/__tests__/work-items-openapi.test.ts \
  apps/web/src/lib/rest/work-item-route-handler.ts \
  apps/web/src/app/api/openapi/route.ts \
  apps/web/src/app/api/v1/work-items \
  scripts/generate-work-item-rest-routes.mjs \
  package.json
git commit -m "feat(api): generate OpenAPI-backed REST adapter for work items"
```

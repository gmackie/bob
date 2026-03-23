# P0 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the three blocking issues preventing Bob from being usable: GitHub repo connection, project detail UX with planning pipeline, and remote API decoupling.

**Architecture:** Replace remote `tasks.gmac.io` calls with local DB queries. Wire the existing WorkflowPage into work item views. Fix GitHub repo listing by ensuring OAuth tokens create provider connections.

**Tech Stack:** tRPC, Drizzle ORM, React Query, existing WorkflowPage components

---

## Track A: GitHub Repo Connection (P0)

### Problem
After GitHub OAuth sign-in, the repo connection dropdown shows "No connected repositories." The `ensureGitHubConnectionFromOAuth` function in `providerConnectionService.ts` should auto-create a git provider connection from the OAuth account, but it's either not being called or failing silently.

### Task A1: Verify and fix GitHub OAuth → provider connection flow

**Files:**
- Read: `packages/api/src/services/git/providerConnectionService.ts:27-54` (`ensureGitHubConnectionFromOAuth`)
- Read: `packages/api/src/router/gitProviders.ts:21-24` (`listConnections`)
- Read: `apps/web/src/app/(dashboard)/settings/_components/git-providers.tsx`
- Read: `apps/web/src/server/git/user-repos.ts:56-111` (`listUserReposByProvider`)

**Step 1: Trace the connection flow**

Check `ensureGitHubConnectionFromOAuth` — it should:
1. Look up the user's OAuth account (from BetterAuth's `account` table)
2. Extract the GitHub access token
3. Create a `gitProviderConnections` row with encrypted token

Verify this function is called when `listConnections` is invoked. If the OAuth account doesn't have the token stored, or the encryption is failing, or the GitHub API scope doesn't include `repo`, the connection won't work.

**Step 2: Check OAuth token storage**

Query the database to see if the OAuth account has a token:
```sql
SELECT id, provider_id, access_token, scope FROM account WHERE user_id = (SELECT id FROM "user" LIMIT 1);
```

If `access_token` is null or the scope doesn't include `repo`, the OAuth configuration needs fixing.

**Step 3: Check that GitHub OAuth scopes include `repo`**

In `packages/auth/src/index.ts`, the GitHub social provider config has:
```typescript
scope: ["user:email", "repo", "read:user"],
```

Verify this is correct. The `repo` scope gives access to private repos.

**Step 4: Fix the connection flow**

Likely fixes:
- The `ensureGitHubConnectionFromOAuth` may not find the account because BetterAuth stores accounts differently than expected
- The token encryption may fail if `AUTH_SECRET` isn't set (used as encryption key)
- The GitHub API client may not be initialized correctly for OAuth tokens

**Step 5: Test**

After fix, navigate to Settings → Git Providers. Should show "GitHub" as a connected provider. Then on a project page, the repo selector should list GitHub repos.

**Step 6: Commit**

```bash
git commit -m "fix(git): ensure GitHub OAuth token creates provider connection for repo access"
```

---

### Task A2: Add GitHub repo browser to project detail page

**Files:**
- Modify: `apps/web/src/components/projects/repo-selector.tsx`
- Read: `apps/web/src/app/api/planning/repo-options/route.ts`

**Step 1: Verify the repo-options API works**

```bash
curl -s http://localhost:3100/api/planning/repo-options
```

If this returns repos, the frontend just needs to wire the selector correctly.

**Step 2: If no repos returned, check the API route**

The `/api/planning/repo-options` route calls `listUserReposByProvider` which calls `getProviderClientForUser` which needs an active provider connection. This depends on Task A1.

**Step 3: Commit**

```bash
git commit -m "fix(projects): wire repo selector to GitHub provider connection"
```

---

## Track B: Remote API Decoupling (P0)

### Problem
The planning router (`packages/api/src/router/planning.ts`) proxies ALL operations to `tasks.gmac.io`. Without a `PLANNING_API_KEY`, queries return empty arrays (our fix from earlier), but mutations (createTask, updateTask) return empty objects — silently failing.

### Task B1: Replace remote workspace/project queries with local DB

**Files:**
- Modify: `packages/api/src/router/planning.ts`

The `listWorkspaces` call was already fixed (returns `[]` without API key). Now replace the `listProjects` and `getProject` calls to use local data when no API key is set.

**Step 1: Update `listProjects` to fall back to local**

```typescript
listProjects: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const planningApiKey = getPlanningApiKey();

    if (!planningApiKey) {
      // Use local project data
      const projectRows = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, input.workspaceId),
        orderBy: desc(projects.updatedAt),
      });

      const items = await ctx.db.query.workItems.findMany({
        where: eq(workItems.workspaceId, input.workspaceId),
      });

      return projectRows.map((project) => ({
        project: {
          id: project.id,
          name: project.name,
          key: project.key,
          status: project.status,
          color: project.color,
        },
        issueCount: items.filter((i) => i.projectId === project.id && i.kind === "issue").length,
        completedCount: items.filter((i) => i.projectId === project.id && i.status === "done").length,
      }));
    }

    return planningQuery<...>("project.list", input);
  }),
```

**Step 2: Update `getProject` similarly**

**Step 3: Commit**

```bash
git commit -m "feat(api): planning router falls back to local DB for project queries"
```

---

### Task B2: Replace remote task/issue operations with local work items

**Files:**
- Modify: `packages/api/src/router/planning.ts`

This is the biggest change. The remote API's `issue.list`, `issue.get`, `issue.create`, `issue.update` need local equivalents.

**Step 1: Replace `listTasks` with local query**

When no API key, query `workItems` table filtered by projectId/workspaceId/status/kind. The remote API returns issues with fields like `identifier`, `title`, `status`, `priority`, `assignee`. Map local work items to the same shape.

**Step 2: Replace `getTask` with local query**

Query `workItems` by ID, join with project for identifier.

**Step 3: Replace `createTask` with local insert**

Insert into `workItems` table with the provided fields. Generate `sequenceNumber` by max+1 for the project.

**Step 4: Replace `updateTask` with local update**

Update `workItems` fields. Keep the automation trigger (`onTaskStatusChange`) since it works locally.

**Step 5: Replace `addComment` and `listComments`**

Use the local `comments` table (already exists in schema).

**Step 6: Agent operations**

`agentClaimTask`, `agentReportProgress`, `agentCompleteTask`, `agentFailTask` — these can use local work item status updates. The `agent.startSession`/`agent.endSession` can be no-ops when running locally.

**Step 7: Commit**

```bash
git commit -m "feat(api): planning router uses local work items when PLANNING_API_KEY not set"
```

---

### Task B3: Update project detail page to use local data

**Files:**
- Modify: `apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx`

The project detail page uses `createPlanningCaller()` to call `planning.getProject` and `planning.listTasks`. Since we've made these fall back to local in Task B2, the page should work without changes — but verify.

**Step 1: Test the page loads**

Navigate to a project page. It should show project details from local DB.

**Step 2: If the page still fails, trace which specific call is failing**

The page calls:
- `caller.project.get({ id: projectId })` — this is the LOCAL project router, not planning
- `caller.workItems.list(...)` — this is LOCAL

So the project detail page should already work with local data! The issue is likely that the project was created through the remote API and the project detail page expects the remote API's response shape. Verify the response shapes match.

**Step 3: Commit if changes needed**

```bash
git commit -m "fix(projects): ensure project detail page works with local-only data"
```

---

## Track C: Project Detail UX with Planning Pipeline (P0)

### Problem
The project detail page shows raw "execution controls" (repo mapping, kanban board columns). It should show the planning pipeline view for issues and epics — the pipeline stepper, stage sections with session history, and launch session buttons.

### Task C1: Wire planning pipeline into work item detail from project page

**Files:**
- Read: `apps/web/src/app/(dashboard)/work-items/[workItemId]/page.tsx`
- Read: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workflow-page-client.tsx`
- Modify: `apps/web/src/components/projects/project-detail-tabs.tsx`

The work item detail page ALREADY shows the WorkflowPage with pipeline stepper for issues/epics. The project detail page just needs to link to work items properly so users can navigate to the pipeline view.

**Step 1: Enhance Board tab to link work items to their detail pages**

In `project-detail-tabs.tsx`, make work item titles clickable links to `/work-items/[id]`:

```tsx
<Link href={`/work-items/${item.id}`}>
  {item.title}
</Link>
```

**Step 2: Enhance List tab similarly**

Make the identifier column a link to the work item detail page.

**Step 3: Add stage badge to list items**

Import and use the `StageBadge` component we built to show pipeline stage next to each work item.

**Step 4: Commit**

```bash
git commit -m "feat(projects): link work items to pipeline detail view + stage badges"
```

---

### Task C2: Improve the "New work item" → planning flow

**Files:**
- Read: `apps/web/src/components/work-items/create-work-item-button.tsx`
- Modify: `apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx`

**Step 1: Wire the "Plan with Bob" button**

The project page header has a "Plan with Bob" button. Wire it to:
1. Create a new work item (issue, kind "issue", status "draft")
2. Create a planning session (planningSessionType: "office_hours")
3. Navigate to `/work-items/[newId]/plan/[sessionId]`

This is the same flow as the `NewIdeaButton` component we already built. Import and use it.

**Step 2: Commit**

```bash
git commit -m "feat(projects): wire 'Plan with Bob' to create work item + launch split-view"
```

---

### Task C3: Fix font paths in source (one-time)

**Files:**
- Already fixed: `apps/web/src/app/layout.tsx`

The font path fix (`../../../public/fonts` → `../../public/fonts`) was already committed locally in commit `cddbbd9`. Verify it's correct and that builds work locally.

---

## Execution Order

```
A1 (GitHub OAuth → connection) ←── blocking for repo access
  ↓
A2 (Repo browser on project page) ←── depends on A1

B1 (Local project queries) ←── independent
  ↓
B2 (Local task/issue operations) ←── depends on B1
  ↓
B3 (Verify project page works) ←── depends on B2

C1 (Pipeline links in project tabs) ←── independent
  ↓
C2 (Plan with Bob button) ←── independent
  ↓
C3 (Font paths) ←── already done
```

**Parallel tracks:** A, B, and C can be worked in parallel since they touch different files.

**Total effort:** human: ~3-4 days / CC: ~1-2 hours

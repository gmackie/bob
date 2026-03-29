# ForgeGraph Work Item Integration Plan

**Date:** 2026-03-27
**Status:** Ready for integration
**ForgeGraph commit:** `6e56a5b` on `main`

## Summary

ForgeGraph now owns the canonical `work_item` entity. Bob should create work items in ForgeGraph (not just locally) and use ForgeGraph as the source of truth for work item state, hierarchy, artifacts, and delivery readiness.

All endpoints use Bearer token auth (`FG_API_TOKEN`). Base URL: `https://forge.gmac.io`.

---

## API Reference

### Work Items CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fg/work-items` | List work items. Filters: `parentId`, `repositoryId`, `status`, `kind`, `externalId`, `limit`, `offset` |
| `GET` | `/api/fg/work-items?externalId=<bob-id>` | Lookup by Bob's internal ID |
| `POST` | `/api/fg/work-items` | Create a work item. Idempotent on `externalId`. |
| `GET` | `/api/fg/work-items/:id` | Full detail: children, deps, artifacts, recent activity, changeset link |
| `PATCH` | `/api/fg/work-items/:id` | Update fields (title, description, kind, assignee, parentId, repositoryId) |
| `PATCH` | `/api/fg/work-items/:id` | Update status: `{ "status": "approved", "actorId": "bob" }` — logged to activity trail |
| `DELETE` | `/api/fg/work-items/:id` | Delete (cascades children, deps, artifacts, activities) |

### Create Work Item (POST body)

```json
{
  "kind": "task",
  "title": "Implement auth middleware",
  "description": "Optional description",
  "parentId": "parent-work-item-id-if-epic",
  "repositoryId": "forgegraph-repo-id",
  "externalId": "bob-internal-uuid",
  "assignee": "bob",
  "status": "draft",
  "metadata": { "source": "planning-session-123" },
  "changesetId": "optional-link-at-creation"
}
```

- `externalId` enables idempotent creates — if a work item with that ID already exists, the existing record is returned (no duplicate).
- `kind`: `"issue"` | `"epic"` | `"task"`
- `status`: `"draft"` | `"ready_for_review"` | `"changes_requested"` | `"approved"` | `"ready_for_staging"` | `"staging_failed"` | `"staging_verified"` | `"ready_for_release"` | `"released"`

### Changeset Linkage

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/api/fg/work-items/:id/link` | Link or relink: `{ "changesetId": "..." }`. Idempotent. |
| `DELETE` | `/api/fg/work-items/:id/link` | Unlink changeset |

Relinking clears `lastReadinessVerdict` so the next evidence event recomputes fresh.

### Dependencies

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fg/work-items/:id/dependencies` | List dependencies |
| `POST` | `/api/fg/work-items/:id/dependencies` | Add: `{ "dependsOnWorkItemId": "..." }`. Idempotent. |
| `DELETE` | `/api/fg/work-items/:id/dependencies` | Remove: `{ "dependsOnWorkItemId": "..." }` |

### Artifacts (BRDs, PRs, test reports, etc.)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fg/work-items/:id/artifacts` | List current artifacts. `?type=brd` to filter. `?all=true` for history. |
| `POST` | `/api/fg/work-items/:id/artifacts` | Attach artifact. Previous same-type+role marked `isCurrent: false`. |

```json
{
  "producerType": "bob",
  "producerId": "bob-session-456",
  "artifactType": "brd",
  "artifactRole": "primary",
  "title": "Auth middleware BRD",
  "summary": "Requirements for the auth middleware feature",
  "content": "Full BRD markdown content...",
  "url": "https://optional-link.example.com",
  "metadata": { "sessionId": "planning-session-123" }
}
```

- `artifactType`: `"pr"` | `"verification"` | `"brd"` | `"test_report"` | `"screenshot"` | `"log"` | `"deployment"` | `"configuration"` | `"other"`
- `producerType`: `"bob"` | `"forgegraph"` | `"user"` | `"system"`

### Activity / Event Reporting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fg/work-items/:id/activities` | List activity history. `?limit=50` |
| `POST` | `/api/fg/work-items/:id/activities` | Record an event |

```json
{
  "actorId": "bob",
  "type": "planning_session_completed",
  "metadata": { "sessionId": "abc", "tasksGenerated": 5 }
}
```

Activity types: `"comment_added"` | `"status_changed"` | `"artifact_added"` | `"notification_created"` | `"build_status_changed"` | `"deploy_status_changed"` | `"planning_session_completed"` | `"review_requested"` | `"review_approved"` | `"review_changes_requested"`

Status changes via `PATCH /api/fg/work-items/:id` with `{ "status": "..." }` are automatically recorded in the activity trail.

### Delivery Readiness (already exists)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fg/work-items/readiness?workItemId=...` | Single work item delivery readiness |
| `POST` | `/api/fg/work-items/readiness` | Bulk readiness (max 25): `{ "workItemIds": [...] }` |

Returns verdict (`ready`/`blocked`/`incomplete`/`failed`/`not-linked`/`error`), evidence, blockers, nextAction, lane status.

### Existing endpoints (unchanged)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/evidence` | Ingest build/test evidence (triggers readiness webhook) |
| `POST/GET` | Release candidate endpoints | RC creation, validation, promotion |
| `POST/GET` | Execution request endpoints | Staging/prod execution requests |

---

## Integration Steps for Bob

### Phase 1: Create work items in ForgeGraph

When Bob creates a work item locally, also `POST /api/fg/work-items` with `externalId` set to Bob's internal UUID. This is idempotent so retries are safe.

```typescript
// In Bob's work item creation flow
const fgWorkItem = await fetch(`${FG_BASE}/api/fg/work-items`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${FG_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    kind: localItem.kind,
    title: localItem.title,
    description: localItem.description,
    parentId: localItem.parentFgId, // FG ID of parent, if any
    externalId: localItem.id, // Bob's UUID
    assignee: "bob",
  }),
});
```

### Phase 2: State transitions through ForgeGraph

Instead of updating status locally only, `PATCH /api/fg/work-items/:id` with the new status. ForgeGraph enforces the lifecycle state machine and records the transition in the activity trail.

### Phase 3: Attach artifacts

When Bob generates a BRD, completes a planning session, or observes a CI result, `POST /api/fg/work-items/:id/artifacts` with the artifact. ForgeGraph tracks versions — the previous artifact of the same type+role is marked `isCurrent: false`.

### Phase 4: Link changesets

When Bob begins execution on a work item, `PUT /api/fg/work-items/:id/link` with the changeset ID. This enables delivery readiness tracking via the existing readiness engine.

### Phase 5: Query readiness from ForgeGraph

Instead of Bob computing its own readiness, poll `GET /api/fg/work-items/readiness?workItemId=...` or consume the readiness webhook (fires when verdict changes after evidence ingestion).

---

## Design.md Coverage

| Requirement | Endpoint | Status |
|---|---|---|
| Work item detail (type, state, parentage, deps) | `GET /api/fg/work-items/:id` | **Done** |
| Child work items and decomposition | `GET /api/fg/work-items?parentId=...` | **Done** |
| Linked planning artifacts and BRDs | `GET /api/fg/work-items/:id/artifacts?type=brd` | **Done** |
| Linked changesets, PRs, CI, deployments, RCs | `GET /api/fg/work-items/:id` (changesetLink) + existing endpoints | **Done** |
| Delivery summary | `GET /api/fg/work-items/readiness` | **Done** |
| Changeset evidence summary | `GET /api/fg/evidence?changesetId=...` | **Pre-existing** |
| Release candidate status | Existing RC endpoints | **Pre-existing** |
| Promotion state and lane status | Included in readiness response | **Done** |
| Policy and automation config | Existing execution policy endpoints | **Pre-existing** |
| Create work item | `POST /api/fg/work-items` | **Done** |
| Update work item type | `PATCH /api/fg/work-items/:id` | **Done** |
| Update work item state | `PATCH /api/fg/work-items/:id` (status) | **Done** |
| Create parent/child edges | `POST` with `parentId` | **Done** |
| Create dependency edges | `POST /api/fg/work-items/:id/dependencies` | **Done** |
| Attach BRDs and planning artifacts | `POST /api/fg/work-items/:id/artifacts` | **Done** |
| Attach or relink changeset | `PUT /api/fg/work-items/:id/link` | **Done** |
| Link PRs, CI runs, deployments, alerts, RCs | Via artifacts (type=pr) + existing endpoints | **Done** |
| Mark ready for staging | `PATCH` with `status: "ready_for_staging"` | **Done** |
| Request RC creation | Existing RC endpoint | **Pre-existing** |
| Request production PR creation | `POST /artifacts` with `type: "pr"` + status change | **Covered** |
| Request promotion/closure | Existing RC promote + status update | **Pre-existing** |
| Planning milestones | `POST /api/fg/work-items/:id/activities` | **Done** |
| Execution session lifecycle | `POST /activities` with metadata | **Done** |
| BRD outputs | `POST /api/fg/work-items/:id/artifacts` (type=brd) | **Done** |
| CI observations | `POST /activities` (type=build_status_changed) | **Done** |
| Re-entry conditions | `PATCH` status back to earlier state + activity | **Done** |
| Blocker/recommendation events | `POST /activities` with metadata | **Done** |
| Webhook for state changes | Readiness webhook (existing) | **Done** |

### Not yet implemented (future)

- Policy-gated state transitions (currently ForgeGraph accepts all valid transitions)
- Work item webhook notifications beyond readiness changes
- Assignment/execution queue feed endpoint
- Workspace/project scoping (ForgeGraph uses repositoryId, not workspaceId)

# Nodes Detail Page Design

## Problem

The current `/nodes` page is a flat card grid showing all workspaces. Each node gets a small card with limited info. There's no way to see a full operational overview of a specific node. As users manage multiple nodes, the page doesn't scale.

## Design

### Nodes Index (`/nodes`)

Replace the card grid with a minimal table. Each row links to the node detail page.

| Column    | Content                                |
|-----------|----------------------------------------|
| Status    | Green/gray dot                         |
| Name      | Machine ID (e.g. "labnuc"), clickable  |
| Workspace | Workspace name/slug                    |
| Agents    | Count of configured agents             |
| Repos     | Count of linked repos                  |
| Last Seen | Relative timestamp                     |

Header keeps title + summary ("1 online, 2 total"). Empty state: `bob init` prompt.

### Node Detail (`/nodes/[machineId]`)

Two-column layout. Left panel ~1/3 width (sticky), right panel ~2/3 (scrollable).

#### Left Panel (Status)

- Machine name + online/offline badge
- Last heartbeat (relative, absolute on hover)
- Workspace name, slug, truncated ID
- Quick stats: agent count, repo count
- "Needs attention" list: offline agents, dirty/stale repos. Hidden when empty.

#### Right Panel (Detail)

**Agents section** (top):
- 2-column grid of agent cards
- Each card: agent name, status badge (available/running/error), current task + repo if active, last activity time
- Data from `workspace.agentConfigs` JSON

**Repositories section** (below):
- List rows: repo name (with remote link), current branch, main branch, dirty/stale flags
- Filtered by `workspaceId` match

### Routing

- `/nodes` — index (table)
- `/nodes/[machineId]` — detail (two-column)
- Both under `(dashboard)` layout

### Data

No new API routes. Existing `workspace.list` and `repository.list` provide all data. Filter client-side by `machineId` for detail page.

Polling: 15s workspaces, 30s repos (same as current).

### Agent Status

Currently display configured agents from `agentConfigs` JSON keys. Running/error states require future gateway integration — for now agents show as "available" if configured.

/**
 * Local simulator-validation seed. Not part of the product: it fills a PGlite
 * data dir with one workspace's worth of believable content so every mobile
 * screen has something to render. Run it with BOB_DB_DRIVER=pglite and
 * BOB_DB_PGLITE_DIR pointed at the directory the dev server will use, then
 * start the server once this process has exited (PGlite is single-writer).
 */
import { db } from "./src/client";
import {
  chatConversations,
  notifications,
  projects,
  tenantMembers,
  tenants,
  user,
  workItems,
  workspaces,
} from "./src/schema";

const USER_ID = "default-user";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333331";
const PROJECT_B = "33333333-3333-4333-8333-333333333332";

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

async function main() {
  await db
    .insert(user)
    .values({
      id: USER_ID,
      name: "Bob Dev User",
      email: "default-user@dev.bob.local",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  await db
    .insert(tenants)
    .values({ id: TENANT_ID, name: "gmackie", slug: "gmackie", plan: "pro" })
    .onConflictDoNothing();

  await db
    .insert(tenantMembers)
    .values({ tenantId: TENANT_ID, userId: USER_ID, role: "owner" })
    .onConflictDoNothing();

  await db
    .insert(workspaces)
    .values({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
      ownerUserId: USER_ID,
      name: "gmacko",
      slug: "gmacko",
      description: "Local validation workspace",
      defaultAgentType: "claude",
      lastHeartbeat: iso(1),
    })
    .onConflictDoNothing();

  await db
    .insert(projects)
    .values([
      {
        id: PROJECT_A,
        workspaceId: WORKSPACE_ID,
        leadUserId: USER_ID,
        name: "Bob",
        key: "BOB",
        description: "The product itself",
        color: "#6366f1",
        status: "active",
        defaultAgentType: "claude",
      },
      {
        id: PROJECT_B,
        workspaceId: WORKSPACE_ID,
        leadUserId: USER_ID,
        name: "OODA",
        key: "OODA",
        description: "Runner and daemon",
        color: "#10b981",
        status: "active",
        defaultAgentType: "codex",
      },
    ])
    .onConflictDoNothing();

  // Statuses chosen to light up every lane the phone renders: Needs you
  // (blocked / in_review / failed), Running, Up next (queued), and done.
  const items = [
    ["Proxy accounts stop serving after a cooldown", "blocked", PROJECT_A, 1],
    ["Tab bar loses the active tab on deep links", "in_review", PROJECT_A, 2],
    ["Heartbeat drops the proxy snapshot", "failed", PROJECT_B, 3],
    ["Wire proxy control through the gateway", "running", PROJECT_A, 4],
    ["Codex runs ignore the per-run CODEX_HOME", "running", PROJECT_B, 5],
    ["Settings needs an inference proxy panel", "queued", PROJECT_A, 6],
    ["Pull-to-refresh on the outcome list", "queued", PROJECT_A, 7],
    ["Notification matrix for proxy events", "queued", PROJECT_B, 8],
    ["Nodes page shows account cooldowns", "done", PROJECT_A, 9],
    ["Mobile navigation rebuilt around tabs", "done", PROJECT_A, 10],
  ] as const;

  await db
    .insert(workItems)
    .values(
      items.map(([title, status, projectId, n], index) => ({
        ownerUserId: USER_ID,
        workspaceId: WORKSPACE_ID,
        projectId,
        sequenceNumber: n,
        queueSortOrder: index,
        kind: "task" as const,
        title,
        description: `Seeded for local simulator validation (#${n}).`,
        status,
        createdAt: iso(600 - n * 30),
        updatedAt: iso(120 - n * 5),
      })),
    )
    .onConflictDoNothing();

  const seeded = await db.select().from(workItems);
  const blocked = seeded.find((i) => i.status === "blocked");
  const running = seeded.filter((i) => i.status === "running");

  await db
    .insert(chatConversations)
    .values(
      running.map((item, index) => ({
        userId: USER_ID,
        title: item.title,
        agentType: index === 0 ? "claude" : "codex",
        sessionType: "execution",
        status: "running",
        workItemId: item.id,
        workItemIdentifierSnapshot: `BOB-${item.sequenceNumber}`,
        lastActivityAt: iso(index + 1),
        gitBranch: `feat/seed-${item.sequenceNumber}`,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(notifications)
    .values([
      {
        userId: USER_ID,
        workItemId: blocked?.id,
        type: "work_item_needs_input" as const,
        title: "Claude is waiting on you",
        body: "Confirm the cooldown policy before the run continues.",
        url: "/nodes",
        createdAt: iso(4),
      },
      {
        userId: USER_ID,
        type: "proxy_unreachable" as const,
        title: "Inference proxy unreachable",
        body: "The runner could not reach the proxy for 3 minutes.",
        url: "/nodes",
        createdAt: iso(9),
      },
      {
        userId: USER_ID,
        type: "work_item_review_ready" as const,
        title: "Ready for your review",
        body: "Tab bar loses the active tab on deep links",
        url: "/tasks",
        read: true,
        readAt: iso(30),
        createdAt: iso(45),
      },
    ])
    .onConflictDoNothing();

  console.log(
    JSON.stringify({
      workItems: seeded.length,
      sessions: running.length,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

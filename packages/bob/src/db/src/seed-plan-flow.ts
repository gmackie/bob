/**
 * Plan-flow fixture for the simulator.
 *
 * Prepare inserts one planning session, one draft, and one repository so
 * Create tasks / Run in Bob / Watch can run against the local PGlite seed.
 * Cleanup removes that fixture and every row the run created (the filed work
 * item, its dispatch batch, task run, and execution session) so the seeded
 * workspace is back to its original counts.
 *
 * PGlite is single-writer. Stop the API before either command.
 *
 *   BOB_DB_DRIVER=pglite BOB_DB_PGLITE_DIR=/tmp/bob-maestro-pglite \
 *     PLAN_FLOW_REPO=/path/to/repo tsx src/seed-plan-flow.ts prepare
 *   tsx src/seed-plan-flow.ts cleanup
 *
 * PLAN_FLOW_REPO is the single repository Run in Bob attaches to the task.
 * It defaults to the current working directory.
 */
import { sql } from "drizzle-orm";

import { db } from "./client";

const USER_ID = "default-user";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333331";

export const PLAN_SESSION_ID = "55555555-5555-4555-8555-555555555551";
export const PLAN_DRAFT_ID = "55555555-5555-4555-8555-555555555552";
export const PLAN_REPO_ID = "55555555-5555-4555-8555-555555555553";
export const PLAN_DRAFT_TITLE = "Cooldown remaining";

const REPO_PATH = process.env.PLAN_FLOW_REPO ?? process.cwd();

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}

async function query(statement: ReturnType<typeof sql>): Promise<Row[]> {
  return rowsOf(await db.execute(statement));
}

async function counts() {
  const [items] = await query(sql`select count(*)::int as n from work_items`);
  const [sessions] = await query(sql`select count(*)::int as n from chat_conversations`);
  return {
    workItems: Number(items?.n ?? 0),
    sessions: Number(sessions?.n ?? 0),
  };
}

async function ensureDraftColumns() {
  await db.execute(sql`alter table plan_drafts add column if not exists kanbanger_issue_id text`);
  await db.execute(
    sql`alter table plan_drafts add column if not exists kanbanger_issue_identifier text`,
  );
  await db.execute(sql`alter table plan_drafts add column if not exists work_item_id uuid`);
}

async function removePlanFlowResidue(): Promise<{ workItemId: string | null }> {
  const [draft] = await query(
    sql`select work_item_id from plan_drafts where id = ${PLAN_DRAFT_ID}::uuid`,
  );
  const workItemId = typeof draft?.work_item_id === "string" ? draft.work_item_id : null;

  if (workItemId) {
    await db.execute(sql`
      delete from dispatch_batches
      where session_id = ${PLAN_SESSION_ID}::uuid
         or id in (
           select batch_id from dispatch_items where planning_task_id = ${workItemId}
         )
    `);
    await db.execute(sql`delete from task_runs where work_item_id = ${workItemId}::uuid`);
    await db.execute(sql`
      delete from chat_conversations
      where work_item_id = ${workItemId}::uuid
        and id <> ${PLAN_SESSION_ID}::uuid
    `);
    await db.execute(sql`delete from work_items where id = ${workItemId}::uuid`);
  } else {
    await db.execute(
      sql`delete from dispatch_batches where session_id = ${PLAN_SESSION_ID}::uuid`,
    );
  }

  await db.execute(sql`delete from repositories where id = ${PLAN_REPO_ID}::uuid`);
  return { workItemId };
}

export async function preparePlanFlow() {
  await ensureDraftColumns();
  const removed = await removePlanFlowResidue();

  await db.execute(sql`
    insert into chat_conversations (
      id, user_id, title, agent_type, session_type, status,
      planning_workspace_id, planning_project_id, planning_project_name
    ) values (
      ${PLAN_SESSION_ID}::uuid, ${USER_ID}, 'Cooldown plan', 'claude', 'planning', 'idle',
      ${WORKSPACE_ID}::uuid, ${PROJECT_ID}::uuid, 'Bob'
    )
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into repositories (
      id, user_id, workspace_id, kanbanger_project_id, name, path, branch, main_branch
    ) values (
      ${PLAN_REPO_ID}::uuid, ${USER_ID}, ${WORKSPACE_ID}::uuid, ${PROJECT_ID},
      'bob', ${REPO_PATH}, 'main', 'main'
    )
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into plan_drafts (
      id, session_id, workspace_id, project_id, title, description,
      kind, priority, sort_order, status,
      kanbanger_issue_id, kanbanger_issue_identifier, work_item_id
    ) values (
      ${PLAN_DRAFT_ID}::uuid, ${PLAN_SESSION_ID}::uuid, ${WORKSPACE_ID}::uuid, ${PROJECT_ID}::uuid,
      ${PLAN_DRAFT_TITLE}, 'Show how long a proxy account stays in cooldown.',
      'task', 'no_priority', 0, 'draft',
      null, null, null
    )
    on conflict (id) do update set
      title = excluded.title,
      status = 'draft',
      kanbanger_issue_id = null,
      kanbanger_issue_identifier = null,
      work_item_id = null
  `);

  return { mode: "prepare", removedWorkItemId: removed.workItemId, ...(await counts()) };
}

export async function cleanupPlanFlow() {
  await ensureDraftColumns();
  const removed = await removePlanFlowResidue();
  await db.execute(sql`delete from plan_drafts where id = ${PLAN_DRAFT_ID}::uuid`);
  await db.execute(sql`delete from chat_conversations where id = ${PLAN_SESSION_ID}::uuid`);
  return { mode: "cleanup", removedWorkItemId: removed.workItemId, ...(await counts()) };
}

const invoked = process.argv[1]?.includes("seed-plan-flow");
if (invoked) {
  const mode = process.argv[2] === "cleanup" ? "cleanup" : "prepare";
  const run = mode === "cleanup" ? cleanupPlanFlow : preparePlanFlow;
  run()
    .then((summary) => {
      console.log(JSON.stringify(summary));
      if (summary.workItems !== 10) {
        console.error(`expected 10 work items, found ${summary.workItems}`);
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { type Database, db, projects, workspaces, users, issues, activities, issueSubscribers } from "@linear-clone/db";
import { buildIssuePayload, dispatchWebhook } from "@linear-clone/api";

const funnelDateInput = z.preprocess(
  (value) => (typeof value === "string" ? new Date(value) : value),
  z.date().optional()
);

const funnelIssueCreateInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  descriptionHtml: z.string().optional(),
  type: z.enum(["issue", "bug", "feature", "epic"]).default("issue"),
  status: z
    .enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"])
    .default("backlog"),
  parentIssueId: z.string().uuid().optional(),
  priority: z.enum(["no_priority", "urgent", "high", "medium", "low"]).default("no_priority"),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  creatorId: z.string().uuid().optional(),
  creatorEmail: z.string().email().optional(),
  dueDate: funnelDateInput,
  funnelSourceType: z
    .enum(["manual", "sentry", "ticket", "forgegraph", "api"])
    .default("api"),
  funnelSourceId: z.string().max(255).optional(),
  funnelSourceUrl: z.string().url().optional(),
  funnelTshirtSize: z.enum(["xs", "s", "m", "l", "xl", "xxl"]).optional(),
  funnelArtifactType: z
    .enum(["idea", "plan", "brd", "spec", "task", "pr", "release"])
    .default("idea"),
  funnelStage: z
    .enum([
      "dumped",
      "triaged",
      "planned",
      "designed",
      "ready_for_execution",
      "picked_up",
      "staging_deployed",
      "staging_verified",
      "production_deployed",
    ])
    .default("dumped"),
  funnelMetadata: z.record(z.unknown()).optional(),
});

let funnelWebhookDbOverride: Database | null = null;

function getWebhookDb() {
  return funnelWebhookDbOverride ?? db;
}

export function setFunnelWebhookDb(database: Database | null) {
  funnelWebhookDbOverride = database;
}

function getExpectedToken() {
  return [process.env.FORGEGRAPH_FUNNEL_WEBHOOK_TOKEN, process.env.FUNNEL_WEBHOOK_TOKEN]
    .find((token) => typeof token === "string" && token.trim().length > 0);
}

function getRequestToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return authorizationHeader.slice("bearer ".length).trim();
  }
  return (
    request.headers.get("x-funnel-token")?.trim() ??
    request.headers.get("x-webhook-token")?.trim()
  );
}

export async function GET() {
  return NextResponse.json({ status: "ok", source: "funnel" });
}

export async function POST(request: NextRequest) {
  const expectedToken = getExpectedToken();
  const requestToken = getRequestToken(request);

  if (!expectedToken || requestToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.text();
  let data: z.infer<typeof funnelIssueCreateInput>;
  try {
    data = funnelIssueCreateInput.parse(JSON.parse(payload));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (data.type === "epic" && (data.teamId || data.assigneeId)) {
    return NextResponse.json(
      { error: "Epics cannot have a team or assignee in funnel ingestion" },
      { status: 400 }
    );
  }

  const database = getWebhookDb();
  const [project] = await database
    .select({
      id: projects.id,
      key: projects.key,
      workspaceId: projects.workspaceId,
      issueCount: projects.issueCount,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let parentIssueId: string | undefined;
  if (data.parentIssueId) {
    const [parentIssue] = await database
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, data.parentIssueId), eq(issues.projectId, data.projectId)))
      .limit(1);

    if (!parentIssue) {
      return NextResponse.json({ error: "Invalid parentIssueId" }, { status: 400 });
    }

    parentIssueId = data.parentIssueId;
  }

  const fallbackTitle =
    data.title?.trim() ||
    data.description?.trim()?.slice(0, 120) ||
    "Untitled idea";

  const [workspace] = await database
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, project.workspaceId))
    .limit(1);

  let creatorId = data.creatorId;
  if (!creatorId && data.creatorEmail) {
    const [creatorByEmail] = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.creatorEmail.toLowerCase()))
      .limit(1);
    creatorId = creatorByEmail?.id;
  }

  if (!creatorId) {
    creatorId = workspace?.ownerId;
  }

  if (!creatorId) {
    return NextResponse.json({ error: "Unable to resolve creator for ingested issue" }, { status: 400 });
  }

  const [updatedProject] = await database
    .update(projects)
    .set({
      issueCount: sql`${projects.issueCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, data.projectId))
    .returning();

  if (!updatedProject) {
    return NextResponse.json({ error: "Failed to update project issue count" }, { status: 500 });
  }

  const issueNumber = updatedProject.issueCount;
  const identifier = `${project.key}-${issueNumber}`;

  const [issue] = await database
    .insert(issues)
    .values({
      ...data,
      title: fallbackTitle,
      projectId: project.id,
      parentId: parentIssueId,
      creatorId,
      number: issueNumber,
      identifier,
      startedAt: data.status === "in_progress" ? new Date() : undefined,
      completedAt: data.status === "done" ? new Date() : undefined,
      canceledAt: data.status === "canceled" ? new Date() : undefined,
    })
    .returning();

  if (!issue) {
    return NextResponse.json({ error: "Failed to create issue" }, { status: 500 });
  }

  const [existingSubscriber] = await database
    .select({ id: issueSubscribers.id })
    .from(issueSubscribers)
    .where(and(eq(issueSubscribers.issueId, issue.id), eq(issueSubscribers.userId, creatorId)))
    .limit(1);

  if (!existingSubscriber) {
    await database.insert(issueSubscribers).values({
      issueId: issue.id,
      userId: creatorId,
    });
  }

  await database.insert(activities).values({
    issueId: issue.id,
    userId: creatorId,
    type: "created",
    metadata: {
      source: "funnel-ingest",
      sourceType: data.funnelSourceType,
      sourceId: data.funnelSourceId,
      sourceUrl: data.funnelSourceUrl,
      tshirtSize: data.funnelTshirtSize,
      artifactType: data.funnelArtifactType,
      stage: data.funnelStage,
    },
  });

  dispatchWebhook(
    database,
    project.workspaceId,
    issue.projectId,
    "issue.created",
    buildIssuePayload(issue)
  ).catch(() => {});

  return NextResponse.json({
    status: "created",
    issueId: issue.id,
    identifier: issue.identifier,
    funnelStage: issue.funnelStage,
  });
}

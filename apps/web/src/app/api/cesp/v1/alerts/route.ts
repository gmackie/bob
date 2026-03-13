import { NextResponse } from "next/server";

import { and, desc, eq, gte, lte } from "@bob/db";
import { db } from "@bob/db/client";
import { agentInstances, eventLog, repositories, taskRuns } from "@bob/db/schema";

import { getSession } from "~/auth/server";

type CespCategory =
  | "session.start"
  | "session.end"
  | "task.acknowledge"
  | "task.complete"
  | "task.error"
  | "input.required"
  | "resource.limit"
  | "task.progress"
  | "user.spam";

type CespAlert = {
  id: string;
  category: CespCategory;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  occurredAt: string;
  source: "task-run" | "agent-instance" | "event-log";
  sourceId: string;
  projectId?: string | null;
  repository?: {
    id: string;
    name: string;
    path: string;
    kanbangerProjectId: string | null;
    planningProjectId?: string | null;
  } | null;
  metadata: Record<string, unknown>;
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseLimit(value: string | null): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) return 100;
  if (parsed > 200) return 200;
  return parsed;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asTimestamp(value: Date | null): string {
  return value ? value.toISOString() : new Date(0).toISOString();
}

function buildProjectId(
  repository:
    | (typeof repositories.$inferSelect & { planningProjectId: string | null })
    | null,
): string | null {
  return repository ? repository.planningProjectId ?? null : null;
}

function buildRepositorySummary(
  repository:
    | (typeof repositories.$inferSelect & { planningProjectId: string | null })
    | null,
) {
  if (!repository) return null;
  return {
    id: repository.id,
    name: repository.name,
    path: repository.path,
    kanbangerProjectId: repository.planningProjectId ?? null,
    planningProjectId: repository.planningProjectId ?? null,
  };
}

function mapTaskRun(run: {
  id: string;
  planningItemIdentifier: string;
  planningItemId: string;
  status: string;
  blockedReason: string | null;
  branch: string | null;
  updatedAt: Date | null;
  createdAt: Date;
  repository:
    | (typeof repositories.$inferSelect & { planningProjectId: string | null })
    | null;
}): CespAlert | null {
  const occurredAt = asTimestamp(run.updatedAt ?? run.createdAt);
  const issueLabel = run.planningItemIdentifier || run.planningItemId;
  if (run.status === "running" || run.status === "starting") {
    return {
      id: `task-run:${run.id}:acknowledge:${occurredAt}`,
      category: "task.acknowledge",
      title: "Task accepted",
      message: `Task ${issueLabel} is now ${run.status}.`,
      severity: "info",
      occurredAt,
      source: "task-run",
      sourceId: run.id,
      projectId: buildProjectId(run.repository),
      repository: buildRepositorySummary(run.repository),
      metadata: {
        issueId: run.planningItemId,
        branch: run.branch ?? null,
        status: run.status,
      },
    };
  }

  if (run.status === "blocked") {
    return {
      id: `task-run:${run.id}:input-required:${occurredAt}`,
      category: "input.required",
      title: "Task input required",
      message: run.blockedReason
        ? `Task ${issueLabel} is waiting for input: ${run.blockedReason}`
        : `Task ${issueLabel} is waiting for input.`,
      severity: "warning",
      occurredAt,
      source: "task-run",
      sourceId: run.id,
      projectId: buildProjectId(run.repository),
      repository: buildRepositorySummary(run.repository),
      metadata: {
        issueId: run.planningItemId,
        branch: run.branch ?? null,
        status: run.status,
        blockedReason: run.blockedReason ?? null,
      },
    };
  }

  if (run.status === "completed") {
    return {
      id: `task-run:${run.id}:complete:${occurredAt}`,
      category: "task.complete",
      title: "Task complete",
      message: `Task ${issueLabel} completed successfully.`,
      severity: "info",
      occurredAt,
      source: "task-run",
      sourceId: run.id,
      projectId: buildProjectId(run.repository),
      repository: buildRepositorySummary(run.repository),
      metadata: {
        issueId: run.planningItemId,
        branch: run.branch ?? null,
        status: run.status,
      },
    };
  }

  if (run.status === "failed") {
    return {
      id: `task-run:${run.id}:error:${occurredAt}`,
      category: "task.error",
      title: "Task failed",
      message: run.blockedReason
        ? `Task ${issueLabel} failed: ${run.blockedReason}`
        : `Task ${issueLabel} failed.`,
      severity: "error",
      occurredAt,
      source: "task-run",
      sourceId: run.id,
      projectId: buildProjectId(run.repository),
      repository: buildRepositorySummary(run.repository),
      metadata: {
        issueId: run.planningItemId,
        branch: run.branch ?? null,
        status: run.status,
        blockedReason: run.blockedReason ?? null,
      },
    };
  }

  return {
    id: `task-run:${run.id}:unknown:${occurredAt}`,
    category: "task.progress",
    title: "Task progress",
    message: `Task ${issueLabel} is currently ${run.status}.`,
    severity: "info",
    occurredAt,
    source: "task-run",
    sourceId: run.id,
    projectId: buildProjectId(run.repository),
    repository: buildRepositorySummary(run.repository),
    metadata: {
      issueId: run.planningItemId,
      branch: run.branch ?? null,
      status: run.status,
    },
  };
}

function mapInstance(instance: {
  id: string;
  status: string;
  agentType: string;
  branch?: string | null;
  worktreePath?: string | null;
  updatedAt: Date | null;
  createdAt: Date;
  repository:
    | (typeof repositories.$inferSelect & { planningProjectId: string | null })
    | null;
}): CespAlert | null {
  const occurredAt = asTimestamp(instance.updatedAt ?? instance.createdAt);
  const sessionId = `${instance.agentType} session`;

  if (instance.status === "starting" || instance.status === "running") {
    return {
      id: `agent-instance:${instance.id}:start:${occurredAt}`,
      category: "session.start",
      title: "Session started",
      message: `${sessionId} is ${instance.status}.`,
      severity: "info",
      occurredAt,
      source: "agent-instance",
      sourceId: instance.id,
      projectId: buildProjectId(instance.repository),
      repository: buildRepositorySummary(instance.repository),
      metadata: {
        agentType: instance.agentType,
        branch: instance.branch ?? null,
        worktreePath: instance.worktreePath ?? null,
        status: instance.status,
      },
    };
  }

  if (instance.status === "stopped") {
    return {
      id: `agent-instance:${instance.id}:end:${occurredAt}`,
      category: "session.end",
      title: "Session ended",
      message: `${sessionId} stopped.`,
      severity: "warning",
      occurredAt,
      source: "agent-instance",
      sourceId: instance.id,
      projectId: buildProjectId(instance.repository),
      repository: buildRepositorySummary(instance.repository),
      metadata: {
        agentType: instance.agentType,
        branch: instance.branch ?? null,
        worktreePath: instance.worktreePath ?? null,
        status: instance.status,
      },
    };
  }

  if (instance.status === "error") {
    return {
      id: `agent-instance:${instance.id}:error:${occurredAt}`,
      category: "task.error",
      title: "Session error",
      message: `${sessionId} reported an error state.`,
      severity: "error",
      occurredAt,
      source: "agent-instance",
      sourceId: instance.id,
      projectId: buildProjectId(instance.repository),
      repository: buildRepositorySummary(instance.repository),
      metadata: {
        agentType: instance.agentType,
        branch: instance.branch ?? null,
        worktreePath: instance.worktreePath ?? null,
        status: instance.status,
      },
    };
  }

  return null;
}

function mapEvent(record: {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  repository: (typeof repositories.$inferSelect & {
    planningProjectId: string | null;
  }) | null;
}): CespAlert | null {
  const occurredAt = asTimestamp(record.createdAt);
  const payload = record.payload;
  const eventType = record.eventType.toLowerCase();
  const workflowStatus = toStringValue(payload.workflowStatus)
    ?? toStringValue(toRecord(payload.state)?.workflowStatus)
    ?? toStringValue(payload.type);
  const payloadMessage =
    toStringValue(payload.message) ??
    toStringValue(toRecord(payload.state)?.message) ??
    toStringValue(toRecord(payload.result)?.message);

  if (
    eventType.includes("resource") ||
    eventType.includes("rate") ||
    eventType.includes("limit") ||
    eventType.includes("quota")
  ) {
    return {
      id: `event-log:${record.id}:resource-limit:${occurredAt}`,
      category: "resource.limit",
      title: "Resource limit reached",
      message: payloadMessage
        ? `Resource limit: ${payloadMessage}`
        : "A resource limit was hit. Check pending tasks.",
      severity: "warning",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
      },
    };
  }

  if (eventType.includes("spam") || eventType.includes("rapid")) {
    return {
      id: `event-log:${record.id}:user-spam:${occurredAt}`,
      category: "user.spam",
      title: "User action rate",
      message: payloadMessage
        ? `High-frequency activity detected: ${payloadMessage}`
        : "High-frequency actions detected.",
      severity: "warning",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
      },
    };
  }

  if (record.eventType === "instance.started") {
    return {
      id: `event-log:${record.id}:session-start:${occurredAt}`,
      category: "session.start",
      title: "Session event",
      message: "Session started.",
      severity: "info",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
      },
    };
  }

  if (record.eventType === "instance.stopped") {
    return {
      id: `event-log:${record.id}:session-end:${occurredAt}`,
      category: "session.end",
      title: "Session event",
      message: "Session ended.",
      severity: "warning",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
      },
    };
  }

  if (record.eventType === "instance.error") {
    return {
      id: `event-log:${record.id}:task-error:${occurredAt}`,
      category: "task.error",
      title: "Session event",
      message: "Session reported an error state.",
      severity: "error",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
      },
    };
  }

  if (workflowStatus === "awaiting_input") {
    return {
      id: `event-log:${record.id}:input-required:${occurredAt}`,
      category: "input.required",
      title: "Workflow event",
      message: "Workflow is waiting for user input.",
      severity: "warning",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
        workflowStatus,
      },
    };
  }

  if (workflowStatus === "completed") {
    return {
      id: `event-log:${record.id}:task-complete:${occurredAt}`,
      category: "task.complete",
      title: "Workflow event",
      message: "Workflow completed.",
      severity: "info",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
        workflowStatus,
      },
    };
  }

  if (workflowStatus && workflowStatus !== "unknown") {
    return {
      id: `event-log:${record.id}:progress:${occurredAt}`,
      category: "task.progress",
      title: "Workflow event",
      message: `Workflow status changed to ${workflowStatus}.`,
      severity: "info",
      occurredAt,
      source: "event-log",
      sourceId: record.id,
      projectId: buildProjectId(record.repository),
      repository: buildRepositorySummary(record.repository),
      metadata: {
        eventType: record.eventType,
        workflowStatus,
      },
    };
  }

  return null;
}

export async function GET(request: Request) {
  const session = await getSession();
  const url = new URL(request.url);
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session?.user?.id ?? (requireAuth ? undefined : "local");

  const rawSince = url.searchParams.get("since");
  const rawUntil = url.searchParams.get("until");
  const rawLimit = url.searchParams.get("limit");

  if (rawSince && !parseDate(rawSince)) {
    return NextResponse.json(
      { error: "Invalid since timestamp" },
      { status: 400 },
    );
  }
  if (rawUntil && !parseDate(rawUntil)) {
    return NextResponse.json(
      { error: "Invalid until timestamp" },
      { status: 400 },
    );
  }

  if (!userId) {
    const since = parseDate(rawSince) ?? new Date();
    const until = parseDate(rawUntil) ?? new Date();
    const limit = parseLimit(rawLimit);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      since: since.toISOString(),
      until: until.toISOString(),
      limit,
      alerts: [],
    });
  }

  const until = parseDate(rawUntil) ?? new Date();
  const fallbackSince = new Date(until.getTime() - 60 * 60 * 1000);
  const since = parseDate(rawSince) ?? fallbackSince;

  if (since.getTime() > until.getTime()) {
    return NextResponse.json(
      { error: "since must be <= until" },
      { status: 400 },
    );
  }
  if (rawSince && !parseDate(rawSince)) {
    return NextResponse.json(
      { error: "Invalid since timestamp" },
      { status: 400 },
    );
  }
  if (rawUntil && !parseDate(rawUntil)) {
    return NextResponse.json(
      { error: "Invalid until timestamp" },
      { status: 400 },
    );
  }

  const limit = parseLimit(rawLimit);
  const sourceLimit = Math.max(limit * 2, 40);

  try {
    const taskRunWhere: Parameters<typeof and>[0][] = [
      eq(taskRuns.userId, userId),
      gte(taskRuns.updatedAt, since),
      lte(taskRuns.updatedAt, until),
    ];

    const instanceWhere: Parameters<typeof and>[0][] = [
      eq(agentInstances.userId, userId),
      gte(agentInstances.updatedAt, since),
      lte(agentInstances.updatedAt, until),
    ];

    const eventWhere: Parameters<typeof and>[0][] = [
      eq(eventLog.userId, userId),
      gte(eventLog.createdAt, since),
      lte(eventLog.createdAt, until),
    ];

    const runs = await db.query.taskRuns.findMany({
      where: and(...taskRunWhere),
      with: {
        repository: true,
      },
      orderBy: desc(taskRuns.updatedAt),
      limit: sourceLimit,
    });

    const instances = await db.query.agentInstances.findMany({
      where: and(...instanceWhere),
      with: {
        repository: true,
      },
      orderBy: desc(agentInstances.updatedAt),
      limit: sourceLimit,
    });

    const events = await db.query.eventLog.findMany({
      where: and(...eventWhere),
      with: {
        repository: true,
      },
      orderBy: desc(eventLog.createdAt),
      limit: sourceLimit,
    });

    const alerts: CespAlert[] = [];
    for (const run of runs) {
      const alert = mapTaskRun(run);
      if (alert) alerts.push(alert);
    }
    for (const instance of instances) {
      const alert = mapInstance(instance);
      if (alert) alerts.push(alert);
    }
    for (const event of events) {
      const payload = toRecord(event.payload);
      const alert = mapEvent({
        id: event.id,
        eventType: event.eventType,
        payload: payload ?? {},
        createdAt: event.createdAt,
        repository: event.repository ?? null,
      });
      if (alert) alerts.push(alert);
    }

    alerts.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    const deduped = alerts.slice(0, limit);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      since: since.toISOString(),
      until: until.toISOString(),
      limit,
      alerts: deduped,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

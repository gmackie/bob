import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, sql } from "@bob/db";
import { comments, projects, workItems, workspaces } from "@bob/db/schema";

import {
  getPlanningApiKey,
  getPlanningBaseUrl,
} from "../services/integrations/planningRemoteConfig";
import { isForgeGraphEnabled, requireForgeGraphClient } from "../services/forgegraph/config";
import { resolveForgeGraphId, cacheMapping } from "../services/forgegraph/idResolver";
import type { FgWorkItem } from "../services/forgegraph/forgeGraphClient";
import { toFgStatus, toBobStatus } from "../services/forgegraph/statusMap";
import { onTaskStatusChange } from "../services/automation/task-trigger";
import { protectedProcedure } from "../trpc";

function formatWorkItemIdentifier(input: {
  projectKey: string | null;
  sequenceNumber: number | null | undefined;
  id: string;
}): string {
  if (input.projectKey && input.sequenceNumber && input.sequenceNumber > 0) {
    return `${input.projectKey}-${input.sequenceNumber}`;
  }

  const suffix = input.id.slice(0, 8).toUpperCase();
  return input.projectKey ? `${input.projectKey}-${suffix}` : `TASK-${suffix}`;
}

/** Map a ForgeGraph work item to the planning task list shape. */
function mapFgToTaskShape(
  fg: FgWorkItem,
  project?: { id: string; name: string; key: string } | null,
) {
  const meta = fg.metadata as { projectKey?: string; sequenceNumber?: number; priority?: string } | null;
  const identifier =
    meta?.projectKey && meta?.sequenceNumber
      ? `${meta.projectKey}-${meta.sequenceNumber}`
      : fg.externalId?.slice(0, 8).toUpperCase() ?? fg.id.slice(0, 8).toUpperCase();

  return {
    id: fg.externalId ?? fg.id,
    identifier,
    title: fg.title,
    description: fg.description ?? undefined,
    status: (fg.metadata as any)?.bobStatus ?? toBobStatus(fg.status),
    priority: (meta?.priority ?? "no_priority") as string,
    kind: fg.kind,
    project: project ? { id: project.id, name: project.name, key: project.key } : undefined,
    assignee: undefined as { id: string; name: string } | undefined,
    labels: [] as Array<{ id: string; name: string; color: string }>,
    dueDate: undefined as string | undefined,
    createdAt: fg.createdAt,
    updatedAt: fg.updatedAt,
    completedAt: undefined as string | undefined,
  };
}

async function planningQuery<T>(path: string, input?: unknown): Promise<T> {
  const planningApiKey = getPlanningApiKey();

  if (!planningApiKey) {
    // Return empty result when remote planning API is not configured
    return [] as unknown as T;
  }

  // tasks.gmac.io rejects POST for query procedures; use GET batch format.
  const inputObj = { "0": { json: input ?? {} } };
  const qs = new URLSearchParams({
    batch: "1",
    input: JSON.stringify(inputObj),
  });

  const url = `${getPlanningBaseUrl()}/api/trpc/${path}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": planningApiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Planning API error: ${text}`,
    });
  }

  const result = (await response.json()) as Array<{
    result?: { data?: { json?: T } };
    error?: { message?: string };
  }>;
  if (result[0]?.error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result[0].error.message ?? "Planning error",
    });
  }

  return result[0]?.result?.data?.json as T;
}

async function planningMutation<T>(path: string, input?: unknown): Promise<T> {
  const planningApiKey = getPlanningApiKey();

  if (!planningApiKey) {
    // Return empty result when remote planning API is not configured
    return {} as unknown as T;
  }

  const url = `${getPlanningBaseUrl()}/api/trpc/${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": planningApiKey,
    },
    body: JSON.stringify(
      input ? { "0": { json: input } } : { "0": { json: {} } },
    ),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Planning API error: ${text}`,
    });
  }

  const result = (await response.json()) as Array<{
    result?: { data?: { json?: T } };
    error?: { message?: string };
  }>;
  if (result[0]?.error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result[0].error.message ?? "Planning error",
    });
  }

  return result[0]?.result?.data?.json as T;
}

const taskStatusEnum = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
const taskPriorityEnum = [
  "no_priority",
  "urgent",
  "high",
  "medium",
  "low",
] as const;

export const planningRouter = {
  listWorkspaces: protectedProcedure.query(async ({ ctx }) => {
    const planningApiKey = getPlanningApiKey();
    if (!planningApiKey) {
      const rows = await ctx.db.query.workspaces.findMany({
        orderBy: desc(workspaces.createdAt),
      });
      return rows.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
      }));
    }

    const memberships = await planningQuery<any[]>("workspace.list");
    return memberships
      .map((m) => m?.workspace ?? m)
      .filter(Boolean)
      .map((w) => ({
        id: w.id as string,
        name: w.name as string,
        slug: w.slug as string,
      }));
  }),

  listProjects: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const projectRows = await ctx.db.query.projects.findMany({
          where: eq(projects.workspaceId, input.workspaceId),
          orderBy: desc(projects.updatedAt),
        });

        const items = await ctx.db.query.workItems.findMany({
          where: eq(workItems.workspaceId, input.workspaceId),
        });

        return projectRows.map((project) => {
          const projectItems = items.filter(
            (item) => item.projectId === project.id,
          );
          return {
            project: {
              id: project.id,
              name: project.name,
              key: project.key,
              status: project.status,
              color: project.color ?? "#6366f1",
            },
            issueCount: projectItems.length,
            completedCount: projectItems.filter(
              (item) => item.status === "done",
            ).length,
          };
        });
      }

      return planningQuery<
        Array<{
          project: {
            id: string;
            name: string;
            key: string;
            status: string;
            color: string;
          };
          issueCount: number;
          completedCount: number;
        }>
      >("project.list", input);
    }),

  getProject: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, input.id),
        });

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        const items = await ctx.db.query.workItems.findMany({
          where: eq(workItems.projectId, input.id),
        });

        return {
          project: {
            id: project.id,
            name: project.name,
            key: project.key,
            description: project.description ?? undefined,
            status: project.status,
            color: project.color ?? "#6366f1",
          },
          issueCount: items.length,
          completedCount: items.filter((item) => item.status === "done").length,
          inProgressCount: items.filter(
            (item) =>
              item.status === "in_progress" || item.status === "in_review",
          ).length,
          backlogCount: items.filter((item) => item.status === "backlog")
            .length,
        };
      }

      return planningQuery<{
        project: {
          id: string;
          name: string;
          key: string;
          description?: string;
          status: string;
          color: string;
        };
        issueCount: number;
        completedCount: number;
        inProgressCount: number;
        backlogCount: number;
      }>("project.get", input);
    }),

  listTasks: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        status: z.enum(taskStatusEnum).optional(),
        priority: z.enum(taskPriorityEnum).optional(),
        assigneeId: z.string().uuid().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // ── ForgeGraph read path ──────────────────────────────────────
      if (isForgeGraphEnabled()) {
        const fg = requireForgeGraphClient();

        const fgFilters: Record<string, string | number> = {};
        if (input.projectId) fgFilters.repositoryId = input.projectId;
        if (input.status) fgFilters.status = input.status;
        fgFilters.limit = input.limit;

        let fgItems = await fg.listWorkItems(fgFilters);

        // Client-side search filter (FG may not support full-text)
        if (input.search) {
          const q = input.search.toLowerCase();
          fgItems = fgItems.filter((item) => item.title.toLowerCase().includes(q));
        }

        // Load projects locally for enrichment
        const projectRows = await ctx.db.query.projects.findMany({
          where: eq(projects.workspaceId, input.workspaceId),
        });
        const projectById = new Map(projectRows.map((p) => [p.id, p]));

        return fgItems.map((fgItem) => {
          if (fgItem.externalId) cacheMapping(fgItem.externalId, fgItem.id);
          const project = fgItem.repositoryId
            ? projectById.get(fgItem.repositoryId) ?? null
            : null;
          return mapFgToTaskShape(
            fgItem,
            project ? { id: project.id, name: project.name, key: project.key } : null,
          );
        });
      }

      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const {
          workspaceId,
          projectId,
          status,
          search,
          limit,
        } = input;

        const filters = [eq(workItems.workspaceId, workspaceId)];
        if (projectId) filters.push(eq(workItems.projectId, projectId));
        if (status) filters.push(eq(workItems.status, status));

        const items = await ctx.db.query.workItems.findMany({
          where: and(...filters),
          orderBy: desc(workItems.updatedAt),
          limit,
        });

        // Filter by search in memory (no ilike available)
        const filtered = search
          ? items.filter((item) =>
              item.title.toLowerCase().includes(search.toLowerCase()),
            )
          : items;

        // Gather projects for identifiers
        const projectIds = Array.from(
          new Set(filtered.map((item) => item.projectId).filter(Boolean)),
        ) as string[];
        const projectRows =
          projectIds.length > 0
            ? await ctx.db.query.projects.findMany({
                where: eq(projects.workspaceId, workspaceId),
              })
            : [];
        const projectById = new Map(
          projectRows.map((p) => [p.id, p]),
        );

        return filtered.map((item) => {
          const project = item.projectId
            ? projectById.get(item.projectId) ?? null
            : null;
          return {
            id: item.id,
            identifier: formatWorkItemIdentifier({
              projectKey: project?.key ?? null,
              sequenceNumber: item.sequenceNumber,
              id: item.id,
            }),
            title: item.title,
            status: item.status,
            priority: "no_priority" as string,
            kind: item.kind,
            project: project
              ? { id: project.id, name: project.name, key: project.key }
              : undefined,
            assignee: undefined,
            labels: [] as Array<{ id: string; name: string; color: string }>,
            dueDate: undefined,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt?.toISOString() ?? item.createdAt.toISOString(),
          };
        });
      }

      const {
        workspaceId,
        projectId,
        status,
        priority,
        assigneeId,
        search,
        limit,
      } = input;
      return planningQuery<
        Array<{
          id: string;
          identifier: string;
          title: string;
          status: string;
          priority: string;
          project?: { id: string; name: string; key: string };
          assignee?: { id: string; name: string };
          labels?: Array<{ id: string; name: string; color: string }>;
          dueDate?: string;
          createdAt: string;
          updatedAt: string;
        }>
      >("issue.list", {
        workspaceId,
        filter: {
          projectId,
          status: status ? [status] : undefined,
          priority: priority ? [priority] : undefined,
          assigneeId,
          search,
        },
        pagination: {
          limit,
          offset: 0,
          sortBy: "updatedAt",
          sortDirection: "desc",
        },
      });
    }),

  getTask: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // ── ForgeGraph read path ──────────────────────────────────────
      if (isForgeGraphEnabled()) {
        const fg = requireForgeGraphClient();
        const fgId = await resolveForgeGraphId(fg, input.id);
        if (fgId) {
          const fgItem = await fg.getWorkItem(fgId);
          const project = fgItem.repositoryId
            ? await ctx.db.query.projects.findFirst({
                where: eq(projects.id, fgItem.repositoryId),
              })
            : null;

          return mapFgToTaskShape(
            fgItem,
            project ? { id: project.id, name: project.name, key: project.key } : null,
          );
        }
        // Not found in FG — fall through to local
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const item = await ctx.db.query.workItems.findFirst({
          where: eq(workItems.id, input.id),
        });

        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found",
          });
        }

        const project = item.projectId
          ? await ctx.db.query.projects.findFirst({
              where: eq(projects.id, item.projectId),
            })
          : null;

        return {
          id: item.id,
          identifier: formatWorkItemIdentifier({
            projectKey: project?.key ?? null,
            sequenceNumber: item.sequenceNumber,
            id: item.id,
          }),
          title: item.title,
          description: item.description ?? undefined,
          status: item.status,
          priority: "no_priority" as string,
          project: project
            ? { id: project.id, name: project.name, key: project.key }
            : undefined,
          assignee: undefined,
          labels: [] as Array<{ id: string; name: string; color: string }>,
          dueDate: undefined,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt?.toISOString() ?? item.createdAt.toISOString(),
          completedAt: undefined,
        };
      }

      return planningQuery<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        project?: { id: string; name: string; key: string };
        assignee?: { id: string; name: string };
        labels?: Array<{ id: string; name: string; color: string }>;
        dueDate?: string;
        createdAt: string;
        updatedAt: string;
        completedAt?: string;
      }>("issue.get", input);
    }),

  getTaskByIdentifier: protectedProcedure
    .input(
      z.object({
        identifier: z.string(),
        workspaceId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // ── ForgeGraph read path ──────────────────────────────────────
      if (isForgeGraphEnabled()) {
        const fg = requireForgeGraphClient();
        const match = input.identifier.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
        if (!match) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        const [, projectKey, seqStr] = match;
        const seqNum = parseInt(seqStr!, 10);
        const pkUpper = projectKey!.toUpperCase();

        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.key, pkUpper),
        });

        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        // Search FG by repositoryId, then match metadata
        const candidates = await fg.listWorkItems({ repositoryId: project.id });
        const fgItem = candidates.find((c) => {
          const meta = c.metadata as { projectKey?: string; sequenceNumber?: number } | null;
          return meta?.projectKey === pkUpper && meta?.sequenceNumber === seqNum;
        });

        if (!fgItem) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        if (fgItem.externalId) cacheMapping(fgItem.externalId, fgItem.id);

        return {
          id: fgItem.externalId ?? fgItem.id,
          identifier: `${pkUpper}-${seqNum}`,
          title: fgItem.title,
          description: fgItem.description ?? undefined,
          status: fgItem.status,
          priority: (fgItem.metadata as any)?.priority ?? ("no_priority" as string),
          projectId: project.id,
          dueDate: undefined as string | undefined,
        };
      }

      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        // Parse identifier like "PROJ-123"
        const match = input.identifier.match(/^([A-Z]+)-(\d+)$/);
        if (!match) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found",
          });
        }

        const [, projectKey, seqStr] = match;
        const seqNum = parseInt(seqStr!, 10);

        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.key, projectKey!),
        });

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found",
          });
        }

        const item = await ctx.db.query.workItems.findFirst({
          where: and(
            eq(workItems.projectId, project.id),
            eq(workItems.sequenceNumber, seqNum),
          ),
        });

        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found",
          });
        }

        return {
          id: item.id,
          identifier: `${project.key}-${item.sequenceNumber}`,
          title: item.title,
          description: item.description ?? undefined,
          status: item.status,
          priority: "no_priority" as string,
          projectId: project.id,
          dueDate: undefined,
        };
      }

      return planningQuery<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        projectId: string;
        dueDate?: string;
      }>("issue.getByIdentifier", input);
    }),

  createTask: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        kind: z.enum(["issue", "epic", "task"]).default("task"),
        status: z
          .enum(["backlog", "todo", "in_progress", "in_review", "done"])
          .default("todo"),
        priority: z.enum(taskPriorityEnum).default("no_priority"),
        assigneeId: z.string().uuid().optional(),
        labelIds: z.array(z.string().uuid()).optional(),
        dueDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ── ForgeGraph write path ──────────────────────────────────────
      if (isForgeGraphEnabled()) {
        const fg = requireForgeGraphClient();

        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, input.projectId),
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        // Generate sequence number locally from existing project work items
        const maxSeqResult = await ctx.db
          .select({ maxSeq: sql<number>`coalesce(max(${workItems.sequenceNumber}), 0)` })
          .from(workItems)
          .where(eq(workItems.projectId, input.projectId));
        const nextSeq = (maxSeqResult[0]?.maxSeq ?? 0) + 1;

        const externalId = crypto.randomUUID();
        const fgItem = await fg.createWorkItem({
          kind: input.kind,
          title: input.title,
          description: input.description,
          status: toFgStatus(input.status),
          repositoryId: project.id,
          externalId,
          metadata: {
            projectKey: project.key,
            sequenceNumber: nextSeq,
            bobStatus: input.status,
          },
        });

        // Cache the mapping so future lookups don't hit the API
        cacheMapping(externalId, fgItem.id);

        // Also insert locally so sequence numbers stay consistent
        const [created] = await ctx.db
          .insert(workItems)
          .values({
            id: externalId,
            ownerUserId: ctx.session.user.id,
            workspaceId: project.workspaceId,
            projectId: input.projectId,
            sequenceNumber: nextSeq,
            kind: input.kind,
            title: input.title,
            description: input.description ?? null,
            status: input.status,
          })
          .returning();

        return {
          id: created!.id,
          identifier: `${project.key}-${nextSeq}`,
          title: created!.title,
          status: created!.status,
          priority: "no_priority" as string,
        };
      }

      // ── Legacy local DB path ───────────────────────────────────────
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, input.projectId),
        });

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        // Auto-generate sequence number: max+1 for project
        const maxSeqResult = await ctx.db
          .select({ maxSeq: sql<number>`coalesce(max(${workItems.sequenceNumber}), 0)` })
          .from(workItems)
          .where(eq(workItems.projectId, input.projectId));
        const nextSeq = (maxSeqResult[0]?.maxSeq ?? 0) + 1;

        const [created] = await ctx.db
          .insert(workItems)
          .values({
            ownerUserId: ctx.session.user.id,
            workspaceId: project.workspaceId,
            projectId: input.projectId,
            sequenceNumber: nextSeq,
            kind: input.kind,
            title: input.title,
            description: input.description ?? null,
            status: input.status,
          })
          .returning();

        return {
          id: created!.id,
          identifier: `${project.key}-${nextSeq}`,
          title: created!.title,
          status: created!.status,
          priority: "no_priority" as string,
        };
      }

      return planningMutation<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
      }>("issue.create", {
        ...input,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      });
    }),

  updateTask: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(taskStatusEnum).optional(),
        priority: z.enum(taskPriorityEnum).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ── ForgeGraph write path ──────────────────────────────────────
      if (isForgeGraphEnabled()) {
        const fg = requireForgeGraphClient();

        // Fetch current task for status transition detection
        const oldItem = await ctx.db.query.workItems.findFirst({
          where: eq(workItems.id, input.id),
        });

        if (!oldItem) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found",
          });
        }

        // Resolve ForgeGraph ID (import inline to avoid circular deps at module level)
        const { requireForgeGraphId } = await import("../services/forgegraph/idResolver");
        const fgId = await requireForgeGraphId(fg, input.id);

        // Build update payload for ForgeGraph
        const fgUpdate: Record<string, unknown> = {};
        if (input.title !== undefined) fgUpdate.title = input.title;
        if (input.description !== undefined) fgUpdate.description = input.description;
        if (input.status !== undefined) {
          fgUpdate.status = toFgStatus(input.status);
          fgUpdate.metadata = { bobStatus: input.status };
        }

        await fg.updateWorkItem(fgId, fgUpdate as any);

        // Also update local DB to keep it in sync
        const localUpdate: Record<string, unknown> = {};
        if (input.title !== undefined) localUpdate.title = input.title;
        if (input.description !== undefined) localUpdate.description = input.description;
        if (input.status !== undefined) localUpdate.status = input.status;

        const [updated] = await ctx.db
          .update(workItems)
          .set(localUpdate)
          .where(eq(workItems.id, input.id))
          .returning();

        const project = oldItem.projectId
          ? await ctx.db.query.projects.findFirst({
              where: eq(projects.id, oldItem.projectId),
            })
          : null;

        const identifier = formatWorkItemIdentifier({
          projectKey: project?.key ?? null,
          sequenceNumber: oldItem.sequenceNumber,
          id: oldItem.id,
        });

        // Fire-and-forget: check if status changed and trigger automation
        if (input.status && oldItem.status !== input.status) {
          onTaskStatusChange({
            taskId: input.id,
            projectId: oldItem.projectId ?? null,
            oldStatus: oldItem.status,
            newStatus: input.status,
            userId: ctx.session.user.id,
            identifier,
            title: oldItem.title,
          }).catch((err) =>
            console.error("[automation] task trigger failed:", err),
          );
        }

        return {
          id: updated!.id,
          identifier,
          title: updated!.title,
          status: updated!.status,
          priority: "no_priority" as string,
        };
      }

      // ── Legacy local DB path ───────────────────────────────────────
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        // Fetch current task for status transition detection
        const oldItem = await ctx.db.query.workItems.findFirst({
          where: eq(workItems.id, input.id),
        });

        if (!oldItem) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found",
          });
        }

        const updateValues: Record<string, unknown> = {};
        if (input.title !== undefined) updateValues.title = input.title;
        if (input.description !== undefined)
          updateValues.description = input.description;
        if (input.status !== undefined) updateValues.status = input.status;

        const [updated] = await ctx.db
          .update(workItems)
          .set(updateValues)
          .where(eq(workItems.id, input.id))
          .returning();

        const project = oldItem.projectId
          ? await ctx.db.query.projects.findFirst({
              where: eq(projects.id, oldItem.projectId),
            })
          : null;

        const identifier = formatWorkItemIdentifier({
          projectKey: project?.key ?? null,
          sequenceNumber: oldItem.sequenceNumber,
          id: oldItem.id,
        });

        // Fire-and-forget: check if status changed and trigger automation
        if (input.status && oldItem.status !== input.status) {
          onTaskStatusChange({
            taskId: input.id,
            projectId: oldItem.projectId ?? null,
            oldStatus: oldItem.status,
            newStatus: input.status,
            userId: ctx.session.user.id,
            identifier,
            title: oldItem.title,
          }).catch((err) =>
            console.error("[automation] task trigger failed:", err),
          );
        }

        return {
          id: updated!.id,
          identifier,
          title: updated!.title,
          status: updated!.status,
          priority: "no_priority" as string,
        };
      }

      // Fetch current task to detect status transitions
      const oldTask = input.status
        ? await planningQuery<{ id: string; status: string; identifier: string; title: string; projectId?: string }>(
            "issue.get",
            { id: input.id },
          ).catch(() => null)
        : null;

      const { dueDate, ...rest } = input;
      const result = await planningMutation<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
      }>("issue.update", {
        ...rest,
        dueDate: dueDate
          ? new Date(dueDate)
          : dueDate === null
            ? null
            : undefined,
      });

      // Fire-and-forget: check if status changed and trigger automation
      if (input.status && oldTask && oldTask.status !== input.status) {
        onTaskStatusChange({
          taskId: input.id,
          projectId: oldTask.projectId ?? null,
          oldStatus: oldTask.status,
          newStatus: input.status,
          userId: ctx.session.user.id,
          identifier: oldTask.identifier ?? result.identifier,
          title: oldTask.title ?? result.title,
        }).catch((err) =>
          console.error("[automation] task trigger failed:", err),
        );
      }

      return result;
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        body: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const [comment] = await ctx.db
          .insert(comments)
          .values({
            workItemId: input.issueId,
            userId: ctx.session.user.id,
            parentId: null,
            body: input.body,
            bodyHtml: null,
          })
          .returning();

        return {
          id: comment!.id,
          body: comment!.body,
          createdAt: comment!.createdAt.toISOString(),
        };
      }

      return planningMutation<{
        id: string;
        body: string;
        createdAt: string;
      }>("comment.create", input);
    }),

  listComments: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        includeReplies: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const rows = await ctx.db.query.comments.findMany({
          where: eq(comments.workItemId, input.issueId),
          orderBy: desc(comments.createdAt),
        });

        return rows.map((c) => ({
          id: c.id,
          body: c.body,
          user: undefined as { id: string; name: string } | undefined,
          createdAt: c.createdAt.toISOString(),
          replies: [] as Array<{
            id: string;
            body: string;
            user?: { id: string; name: string };
            createdAt: string;
          }>,
        }));
      }

      return planningQuery<
        Array<{
          id: string;
          body: string;
          user?: { id: string; name: string };
          createdAt: string;
          replies?: Array<{
            id: string;
            body: string;
            user?: { id: string; name: string };
            createdAt: string;
          }>;
        }>
      >("comment.list", input);
    }),

  searchTasks: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        query: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      // ── ForgeGraph read path ──────────────────────────────────────
      // FG does not support full-text search; fetch all items for the
      // workspace projects and filter client-side.
      if (isForgeGraphEnabled()) {
        const fg = requireForgeGraphClient();

        // Load all projects in workspace to get repositoryIds
        const projectRows = await ctx.db.query.projects.findMany({
          where: eq(projects.workspaceId, input.workspaceId),
        });
        const projectById = new Map(projectRows.map((p) => [p.id, p]));

        // Fetch work items from each project
        const allFgItems: FgWorkItem[] = [];
        for (const proj of projectRows) {
          const items = await fg.listWorkItems({ repositoryId: proj.id, limit: 100 });
          allFgItems.push(...items);
        }
        // Also fetch items without a project
        const unprojectItems = await fg.listWorkItems({ limit: 100 });
        for (const item of unprojectItems) {
          if (!allFgItems.some((existing) => existing.id === item.id)) {
            allFgItems.push(item);
          }
        }

        const q = input.query.toLowerCase();
        const matched = allFgItems
          .filter((item) => item.title.toLowerCase().includes(q))
          .slice(0, input.limit);

        return matched.map((fgItem) => {
          if (fgItem.externalId) cacheMapping(fgItem.externalId, fgItem.id);
          const project = fgItem.repositoryId
            ? projectById.get(fgItem.repositoryId) ?? null
            : null;
          const meta = fgItem.metadata as { projectKey?: string; sequenceNumber?: number } | null;
          const identifier =
            meta?.projectKey && meta?.sequenceNumber
              ? `${meta.projectKey}-${meta.sequenceNumber}`
              : fgItem.externalId?.slice(0, 8).toUpperCase() ?? fgItem.id.slice(0, 8).toUpperCase();

          return {
            id: fgItem.externalId ?? fgItem.id,
            identifier,
            title: fgItem.title,
            status: fgItem.status,
            priority: (fgItem.metadata as any)?.priority ?? ("no_priority" as string),
            project: project ? { id: project.id, name: project.name } : undefined,
            assignee: undefined as { id: string; name: string } | undefined,
          };
        });
      }

      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        const searchPattern = `%${input.query}%`;
        const items = await ctx.db
          .select()
          .from(workItems)
          .where(
            and(
              eq(workItems.workspaceId, input.workspaceId),
              sql`${workItems.title} ILIKE ${searchPattern}`,
            ),
          )
          .orderBy(desc(workItems.updatedAt))
          .limit(input.limit);

        const projectIds = Array.from(
          new Set(items.map((item) => item.projectId).filter(Boolean)),
        ) as string[];
        const projectRows =
          projectIds.length > 0
            ? await ctx.db.query.projects.findMany({
                where: eq(projects.workspaceId, input.workspaceId),
              })
            : [];
        const projectById = new Map(
          projectRows.map((p) => [p.id, p]),
        );

        return items.map((item) => {
          const project = item.projectId
            ? projectById.get(item.projectId) ?? null
            : null;
          return {
            id: item.id,
            identifier: formatWorkItemIdentifier({
              projectKey: project?.key ?? null,
              sequenceNumber: item.sequenceNumber,
              id: item.id,
            }),
            title: item.title,
            status: item.status,
            priority: "no_priority" as string,
            project: project
              ? { id: project.id, name: project.name }
              : undefined,
            assignee: undefined,
          };
        });
      }

      return planningQuery<
        Array<{
          id: string;
          identifier: string;
          title: string;
          status: string;
          priority: string;
          project?: { id: string; name: string };
          assignee?: { id: string; name: string };
        }>
      >("issue.list", {
        workspaceId: input.workspaceId,
        filter: { search: input.query },
        pagination: {
          limit: input.limit,
          offset: 0,
          sortBy: "updatedAt",
          sortDirection: "desc",
        },
      });
    }),

  listLabels: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return [];
      }

      return planningQuery<
        Array<{
          id: string;
          name: string;
          color: string;
          description?: string;
        }>
      >("label.listFlat", input);
    }),

  listCycles: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        status: z.enum(["upcoming", "active", "completed"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return [];
      }

      return planningQuery<
        Array<{
          id: string;
          name: string;
          number: number;
          status: string;
          startDate: string;
          endDate: string;
          progress: number;
          issueCount: number;
          completedCount: number;
        }>
      >("cycle.listByWorkspace", input);
    }),

  getCurrentUser: protectedProcedure.query(async ({ ctx }) => {
    const planningApiKey = getPlanningApiKey();
    if (!planningApiKey) {
      const user = ctx.session.user;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.image ?? undefined,
      };
    }

    return planningQuery<{
      id: string;
      email: string;
      name: string;
      avatarUrl?: string;
    }>("user.me");
  }),

  agentClaimTask: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        issueId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return {
          id: input.issueId,
          issueId: input.issueId,
          status: "claimed",
          claimedAt: new Date().toISOString(),
        };
      }

      return planningMutation<{
        id: string;
        issueId: string;
        status: string;
        claimedAt: string;
      }>("agent.claimTask", input);
    }),

  agentReportProgress: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        progress: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return {
          id: input.taskRunId,
          status: "in_progress",
        };
      }

      return planningMutation<{
        id: string;
        status: string;
      }>("agent.reportProgress", input);
    }),

  agentCompleteTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        summary: z.string().optional(),
        artifacts: z
          .array(
            z.object({
              type: z.enum(["pr", "commit", "file", "comment"]),
              url: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
        markIssueDone: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return {
          id: input.taskRunId,
          status: "completed",
          completedAt: new Date().toISOString(),
        };
      }

      return planningMutation<{
        id: string;
        status: string;
        completedAt: string;
      }>("agent.completeTask", {
        taskRunId: input.taskRunId,
        result: {
          success: true,
          summary: input.summary,
          artifacts: input.artifacts,
        },
        markIssueDone: input.markIssueDone,
      });
    }),

  agentFailTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        errorCode: z.string(),
        errorMessage: z.string(),
        recoverable: z.boolean().default(false),
        returnToBacklog: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return {
          id: input.taskRunId,
          status: "failed",
        };
      }

      return planningMutation<{
        id: string;
        status: string;
      }>("agent.failTask", input);
    }),

  agentGetAvailableTasks: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return [];
      }

      return planningQuery<
        Array<{
          id: string;
          identifier: string;
          title: string;
          description?: string;
          priority: string;
          project?: { id: string; name: string; key: string };
          labels?: Array<{ id: string; name: string }>;
        }>
      >("agent.getAvailableTasks", input);
    }),

  agentStartSession: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        clientInfo: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return {
          id: input.agentId,
          startedAt: new Date().toISOString(),
        };
      }

      return planningMutation<{
        id: string;
        startedAt: string;
      }>("agent.startSession", input);
    }),

  agentEndSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        return {
          id: input.sessionId,
          endedAt: new Date().toISOString(),
        };
      }

      return planningMutation<{
        id: string;
        endedAt: string;
      }>("agent.endSession", input);
    }),
} satisfies TRPCRouterRecord;

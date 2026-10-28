import { Effect } from "effect";
import { z } from "zod/v4";
import type { Db } from "@bob/db/client";
import { and, eq } from "@bob/db";
import {
  projects,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";
import { wrapHandler } from "@bob/api/handlers/bridge";
import {
  workItemsList,
  workItemsGet,
  workItemsUpdate,
  workItemsCreateComment,
} from "@bob/api/handlers/workItems";
import type { OAuthGrant, OAuthIdentity } from "./types";
import { READ_SCOPE, WRITE_SCOPE } from "./oauth";

const uuid = z.string().uuid();
const page = {
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
const definitions = {
  bob_list_projects: {
    description:
      "List projects in the workspace authorized for this connection.",
    schema: z.strictObject(page),
    write: false,
  },
  bob_get_project: {
    description: "Get a project by UUID within the authorized workspace.",
    schema: z.strictObject({ id: uuid }),
    write: false,
  },
  bob_list_work_items: {
    description:
      "List recent work items in the authorized workspace, optionally filtering by project and status.",
    schema: z.strictObject({
      projectId: uuid.optional(),
      status: z.string().max(80).optional(),
      limit: page.limit,
    }),
    write: false,
  },
  bob_get_work_item: {
    description: "Read a work item by UUID in the authorized workspace.",
    schema: z.strictObject({ id: uuid }),
    write: false,
  },
  bob_update_work_item: {
    description:
      "Update a work item's title or description in the authorized workspace. Requires bob:write.",
    schema: z
      .strictObject({
        id: uuid,
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20_000).optional(),
      })
      .refine(
        (v) => v.title !== undefined || v.description !== undefined,
        "Supply a title or description",
      ),
    write: true,
  },
  bob_add_comment: {
    description:
      "Add a comment to a work item in the authorized workspace. Requires bob:write.",
    schema: z.strictObject({
      workItemId: uuid,
      body: z.string().min(1).max(10_000),
    }),
    write: true,
  },
};
export interface McpToolService {
  list(grant: OAuthGrant): unknown[];
  call(grant: OAuthGrant, name: string, args: unknown): Promise<unknown>;
}
function projectView(p: typeof projects.$inferSelect) {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    key: p.key,
    description: p.description,
    status: p.status,
    updatedAt: p.updatedAt,
  };
}
function itemView(p: typeof workItems.$inferSelect) {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    projectId: p.projectId,
    title: p.title,
    description: p.description,
    status: p.status,
    kind: p.kind,
    sequenceNumber: p.sequenceNumber,
    updatedAt: p.updatedAt,
  };
}
export function makeTools(db: Db, identity: OAuthIdentity): McpToolService {
  return {
    list: (grant) =>
      Object.entries(definitions)
        .filter(([, d]) =>
          grant.scopes.includes(d.write ? WRITE_SCOPE : READ_SCOPE),
        )
        .map(([name, d]) => ({
          name,
          description: d.description,
          inputSchema: z.toJSONSchema(d.schema),
          annotations: {
            readOnlyHint: !d.write,
            destructiveHint: false,
            idempotentHint: name !== "bob_add_comment",
            openWorldHint: false,
          },
        })),
    async call(grant, name, args) {
      if (!(name in definitions) || !Object.hasOwn(definitions, name))
        throw new Error("Unknown tool");
      const definition = definitions[name as keyof typeof definitions];
      if (
        !grant.scopes.includes(definition.write ? WRITE_SCOPE : READ_SCOPE) ||
        !(await identity.access(
          grant.userId,
          grant.workspaceId,
          definition.write,
        ))
      )
        throw new Error("Tool access denied");
      const ctx = { db, userId: grant.userId };
      const requireItem = async (id: string) => {
        const item = await db.query.workItems.findFirst({
          where: and(
            eq(workItems.id, id),
            eq(workItems.workspaceId, grant.workspaceId),
          ),
        });
        if (!item) throw new Error("Work item not found");
        return item;
      };
      // The workspace comes from the OAuth grant, never tool arguments. Use
      // Bob's existing Effect bridge for business handlers and their errors.
      switch (name) {
        case "bob_list_projects": {
          const input = definitions.bob_list_projects.schema.parse(args);
          const rows = await db
            .select()
            .from(projects)
            .where(eq(projects.workspaceId, grant.workspaceId))
            .orderBy(projects.id)
            .limit(input.limit + 1)
            .offset(input.offset);
          return {
            projects: rows.slice(0, input.limit).map(projectView),
            nextOffset:
              rows.length > input.limit ? input.offset + input.limit : null,
          };
        }
        case "bob_get_project": {
          const input = definitions.bob_get_project.schema.parse(args);
          const row = await db.query.projects.findFirst({
            where: and(
              eq(projects.id, input.id),
              eq(projects.workspaceId, grant.workspaceId),
            ),
          });
          if (!row) throw new Error("Project not found");
          return projectView(row);
        }
        case "bob_list_work_items": {
          const input = definitions.bob_list_work_items.schema.parse(args);
          if (
            input.projectId &&
            !(await db.query.projects.findFirst({
              where: and(
                eq(projects.id, input.projectId),
                eq(projects.workspaceId, grant.workspaceId),
              ),
              columns: { id: true },
            }))
          )
            throw new Error("Project not found");
          const items = await Effect.runPromise(
            wrapHandler(workItemsList, ctx, {
              ...input,
              workspaceId: grant.workspaceId,
            }),
          );
          return { workItems: items.map(itemView) };
        }
        case "bob_get_work_item": {
          const input = definitions.bob_get_work_item.schema.parse(args);
          await requireItem(input.id);
          const item = await Effect.runPromise(
            wrapHandler(workItemsGet, ctx, input),
          );
          if (!item) throw new Error("Work item not found");
          return itemView(item.workItem);
        }
        case "bob_update_work_item": {
          const input = definitions.bob_update_work_item.schema.parse(args);
          await requireItem(input.id);
          return itemView(
            await Effect.runPromise(wrapHandler(workItemsUpdate, ctx, input)),
          );
        }
        case "bob_add_comment": {
          const input = definitions.bob_add_comment.schema.parse(args);
          await requireItem(input.workItemId);
          const comment = await Effect.runPromise(
            wrapHandler(workItemsCreateComment, ctx, input),
          );
          if (!comment) throw new Error("Comment could not be created");
          return {
            id: comment.id,
            workItemId: comment.workItemId,
            body: comment.body,
            createdAt: comment.createdAt,
          };
        }
        default:
          throw new Error("Unknown tool");
      }
    },
  };
}
export function makeWorkspaceIdentity(
  db: Db,
  session: OAuthIdentity["session"],
): OAuthIdentity {
  return {
    session,
    async workspaces(userId) {
      // Only explicit membership is offered: work-item handlers require it.
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, userId));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        canWrite: r.role !== "viewer",
      }));
    },
    async access(userId, workspaceId, write) {
      const row = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
        columns: { role: true },
      });
      return Boolean(row && (!write || row.role !== "viewer"));
    },
  };
}

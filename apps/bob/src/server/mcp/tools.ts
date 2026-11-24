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
import type { OAuthGrant, OAuthIdentity, OAuthStore } from "./types";
import { READ_SCOPE, WRITE_SCOPE } from "./oauth";
import { VIEW_URIS } from "./apps";
import { makePlanning } from "./planning";
import { issueSdlcTicket } from "./sdlc-ticket";
import { bizpulseConfig } from "../bizpulse/client";
import {
  credentialSetupRequest,
  credentialSetupStatus,
  makeCredentialSetup,
} from "../bizpulse/credential-setup";

const uuid = z.string().uuid();
const page = {
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
type Visibility = ("model" | "app")[];
/** MCP Apps metadata: who may call a tool, and the view it renders. */
const callableBy = (...visibility: Visibility) => ({ ui: { visibility } });
const opensView = (resourceUri: string) => ({
  ui: { resourceUri, visibility: ["model", "app"] as Visibility },
});
const workItemId = uuid.describe("Bob work item id");
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
  bob_workspace: {
    description:
      "List work items and recent runs in the authorized workspace, optionally filtered by project or title. Renders the Bob workspace view.",
    schema: z.strictObject({
      projectId: uuid.optional(),
      query: z.string().max(200).optional().describe("Case-insensitive title filter"),
    }),
    write: false,
    meta: opensView(VIEW_URIS.workspace),
  },
  bob_planning_review: {
    description:
      "Show the planning review for a work item: stages, latest run evidence and the next action. A person approves dispatch from the rendered view.",
    schema: z.strictObject({ workItemId }),
    write: false,
    meta: opensView(VIEW_URIS.planning),
  },
  bob_planning_approve: {
    description: "Record a person's approval to dispatch a work item.",
    schema: z.strictObject({ workItemId }),
    write: true,
    // App-only: the planning review view calls it when a person approves.
    meta: callableBy("app"),
  },
  bob_planning_dispatch: {
    description:
      "Dispatch an approved work item to an agent. Fails unless a person approved it in the planning review. Requires bob:write.",
    schema: z.strictObject({
      workItemId,
      agentType: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe("Agent type, e.g. claude or codex; defaults to Bob's configured agent"),
    }),
    write: true,
    meta: opensView(VIEW_URIS.planning),
  },
  bob_runs_list: {
    description:
      "List recent runs, newest first, for the authorized workspace or one work item.",
    schema: z.strictObject({ workItemId: workItemId.optional() }),
    write: false,
  },
  bob_sdlc: {
    description:
      "Open the Bob SDLC view. With threadId: the plan, state, milestones, pending questions, live tail and CI of the SDLC item running that T3 thread. Without: the fleet. The view reads Bob's SDLC edge live; this tool returns no SDLC state itself.",
    schema: z.strictObject({
      threadId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("T3 thread id; omit for the fleet"),
    }),
    write: false,
    meta: opensView(VIEW_URIS.sdlc),
  },
  bob_sdlc_connect: {
    description: "A single-use URL for the SDLC view's edge socket.",
    schema: z.strictObject({}),
    // The socket accepts commands, so it needs what a device key needs: write.
    write: true,
    meta: callableBy("app"),
  },
};
export interface McpToolService {
  list(grant: OAuthGrant): unknown[] | Promise<unknown[]>;
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
export function makeTools(
  db: Db,
  identity: OAuthIdentity,
  options: { store: Pick<OAuthStore, "addCredential"> & Partial<Pick<OAuthStore, "client">>; origin: string },
): McpToolService {
  const planning = makePlanning(db);
  const credentialSetup = makeCredentialSetup(db);
  const setupTools = {
    bob_credential_setup_request: {
      description: "Create or retrieve a draft for an approved BizPulse credential plan. Requires Bob workspace owner consent and a startup-scoped BizPulse link. Never dispatches.",
      schema: credentialSetupRequest,
      write: true,
    },
    bob_credential_setup_status: {
      description: "Read a BizPulse credential draft and its dispatch approval.",
      schema: credentialSetupStatus,
      write: false,
    },
  };
  async function canUseSetup(grant: OAuthGrant, write: boolean) {
    if (!grant.scopes.includes(write ? WRITE_SCOPE : READ_SCOPE)) return false;
    const config = bizpulseConfig();
    const client = config && await options.store.client?.(grant.clientId);
    return Boolean(
      config && client && client.redirectUris.length === 1 &&
      client.redirectUris[0] === config.origin + "/api/credentials/bob/callback",
    );
  }
  const edge = new URL("/api/sdlc/ws", options.origin);
  edge.protocol = edge.protocol === "https:" ? "wss:" : "ws:";
  return {
    async list(grant) {
      const base = Object.entries(definitions)
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
            idempotentHint: ![
              "bob_add_comment",
              "bob_planning_dispatch",
              "bob_sdlc_connect",
            ].includes(name),
            openWorldHint: false,
          },
          _meta: "meta" in d ? d.meta : callableBy("model"),
        }));
      const setup = [];
      for (const [name, definition] of Object.entries(setupTools)) {
        if (await canUseSetup(grant, definition.write))
          setup.push({
            name,
            description: definition.description,
            inputSchema: z.toJSONSchema(definition.schema),
            annotations: {
              readOnlyHint: !definition.write,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
            _meta: callableBy("model"),
          });
      }
      return [...base, ...setup];
    },
    async call(grant, name, args) {
      if (name === "bob_credential_setup_request" || name === "bob_credential_setup_status") {
        const write = setupTools[name].write;
        if (!(await canUseSetup(grant, write)) ||
            !(await identity.access(grant.userId, grant.workspaceId, write)))
          throw new Error("Tool access denied");
        if (name === "bob_credential_setup_request")
          return credentialSetup.request(grant, credentialSetupRequest.parse(args));
        const input = credentialSetupStatus.parse(args);
        return credentialSetup.status(grant, input.workItemId, input.operationKey);
      }
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
        case "bob_workspace":
          return planning.workspace(
            grant,
            definitions.bob_workspace.schema.parse(args),
          );
        case "bob_planning_review":
          return planning.review(
            grant,
            definitions.bob_planning_review.schema.parse(args).workItemId,
          );
        case "bob_planning_approve": {
          const input = definitions.bob_planning_approve.schema.parse(args);
          await planning.approve(grant, input.workItemId);
          return { workItemId: input.workItemId, approved: true };
        }
        case "bob_planning_dispatch":
          return planning.dispatch(
            grant,
            definitions.bob_planning_dispatch.schema.parse(args),
          );
        case "bob_runs_list":
          return {
            runs: await planning.runs(
              grant,
              definitions.bob_runs_list.schema.parse(args).workItemId,
            ),
          };
        case "bob_sdlc": {
          const input = definitions.bob_sdlc.schema.parse(args);
          return input.threadId
            ? { scope: "thread", threadId: input.threadId }
            : { scope: "fleet" };
        }
        case "bob_sdlc_connect": {
          definitions.bob_sdlc_connect.schema.parse(args);
          const url = new URL(edge);
          url.searchParams.set(
            "ticket",
            await issueSdlcTicket(options.store, grant),
          );
          return { url: url.toString() };
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

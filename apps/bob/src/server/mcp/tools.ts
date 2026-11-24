import { Effect } from "effect";
import { z } from "zod/v4";
import type { Db } from "@bob/db/client";
import { and, eq } from "@bob/db";
import {
  projects,
  workItems,
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
import { McpToolError } from "./errors";
import { linkSchema, readLinkSchema, linearLinks } from "./linear-links";
import { authorizedEdge, readSdlc, type McpSdlcEnv } from "./sdlc";
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
  "ui/resourceUri": resourceUri,
  ui: { resourceUri, visibility: ["model", "app"] as Visibility },
});
const workItemId = uuid.describe("Bob work item id");
const threadId = z.string().min(1).max(200).describe("T3 thread id");
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
    title: "Bob workspace",
    description:
      "List work items and recent runs in the authorized workspace, optionally filtered by project or title. Renders the Bob workspace view.",
    schema: z.strictObject({
      workspaceId: uuid.optional().describe("Must match the workspace selected during OAuth consent"),
      projectId: uuid.optional(),
      threadId: threadId.optional().describe("Only runs for this T3 thread"),
      query: z.string().max(200).optional().describe("Case-insensitive title filter"),
    }),
    write: false,
    meta: opensView(VIEW_URIS.workspace),
  },
  bob_planning_review: {
    title: "Bob planning review",
    description:
      "Show the planning review for a work item: stages, latest run evidence and the next action. A person approves dispatch from the rendered view.",
    schema: z.strictObject({ workItemId }),
    write: false,
    meta: opensView(VIEW_URIS.planning),
  },
  bob_planning_approve: {
    title: "Approve Bob dispatch",
    description: "Record a person's approval to dispatch a work item.",
    schema: z.strictObject({ workItemId }),
    write: true,
    // App-only: the planning review view calls it when a person approves.
    meta: callableBy("app"),
  },
  bob_planning_dispatch: {
    title: "Dispatch Bob work item",
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
  bob_work_item_get: {
    title: "Get Bob work item",
    description: "Get the plugin's work-item detail in the authorized workspace.",
    schema: z.strictObject({ workItemId }),
    write: false,
  },
  bob_linear_links: {
    title: "Bob ↔ Linear links",
    description: "List or get manual Bob ↔ Linear-compatible issue links. Upsert and remove require bob:write.",
    schema: linkSchema,
    write: false,
  },
  bob_runs_list: {
    title: "List Bob runs",
    description:
      "List recent runs, newest first, for the authorized workspace or one work item.",
    schema: z.strictObject({ workItemId: workItemId.optional(), threadId: threadId.optional() }),
    write: false,
  },
  bob_sdlc: {
    title: "Bob SDLC",
    description:
      "Read the SDLC fleet or the item running a T3 thread, including plan progress, questions, current tail and CI.",
    schema: z.strictObject({ threadId: threadId.optional() }),
    write: false,
    meta: opensView(VIEW_URIS.sdlc),
  },
  bob_sdlc_item_for_thread: {
    title: "Bob SDLC item for a thread",
    description: "Get the coordinator item and plan for a T3 thread in the authorized workspace, or null.",
    schema: z.strictObject({ threadId }),
    write: false,
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
  options: { store: Pick<OAuthStore, "addCredential"> & Partial<Pick<OAuthStore, "client">>; origin: string; sdlcEnv: () => McpSdlcEnv },
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
  const canWrite = (grant: OAuthGrant) => grant.scopes.includes(WRITE_SCOPE) && identity.access(grant.userId, grant.workspaceId, true);
  const edge = new URL("/api/sdlc/ws", options.origin);
  edge.protocol = edge.protocol === "https:" ? "wss:" : "ws:";
  return {
    async list(grant) {
      const mayWrite = await canWrite(grant);
      const base = Object.entries(definitions)
        .filter(([, d]) => d.write ? mayWrite : grant.scopes.includes(READ_SCOPE))
        .map(([name, d]) => ({
          name,
          ...("title" in d ? { title: d.title } : {}),
          description: d.description,
          inputSchema: z.toJSONSchema(name === "bob_linear_links" && !mayWrite ? readLinkSchema : d.schema, { io: "input" }),
          annotations: {
            readOnlyHint: !d.write && !(name === "bob_linear_links" && mayWrite),
            destructiveHint: name === "bob_linear_links" && mayWrite,
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
        if ((!definition.write || mayWrite) && await canUseSetup(grant, definition.write))
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
      const link = name === "bob_linear_links" ? linkSchema.parse(args) : undefined;
      const write = definition.write || link?.action === "upsert" || link?.action === "remove";
      if (!grant.scopes.includes(write ? WRITE_SCOPE : READ_SCOPE) || !(await identity.access(grant.userId, grant.workspaceId, write)))
        throw new Error("Tool access denied");
      if (link) return linearLinks(db, grant.workspaceId, link);
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
        case "bob_workspace": {
          const input = definitions.bob_workspace.schema.parse(args);
          if (input.workspaceId && input.workspaceId !== grant.workspaceId)
            throw new McpToolError("workspaceId must match the workspace selected during OAuth consent.");
          return planning.workspace(grant, input);
        }
        case "bob_work_item_get":
          return planning.item(grant, definitions.bob_work_item_get.schema.parse(args).workItemId);
        case "bob_planning_review": {
          const { workItemId } = definitions.bob_planning_review.schema.parse(args);
          const mayWrite = await canWrite(grant);
          return planning.review(grant, workItemId, mayWrite);
        }
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
              definitions.bob_runs_list.schema.parse(args),
            ),
          };
        case "bob_sdlc": {
          const input = definitions.bob_sdlc.schema.parse(args);
          return readSdlc(grant, options.sdlcEnv(), input.threadId);
        }
        case "bob_sdlc_item_for_thread": {
          const input = definitions.bob_sdlc_item_for_thread.schema.parse(args);
          return readSdlc(grant, options.sdlcEnv(), input.threadId, true);
        }
        case "bob_sdlc_connect": {
          definitions.bob_sdlc_connect.schema.parse(args);
          authorizedEdge(grant, options.sdlcEnv());
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

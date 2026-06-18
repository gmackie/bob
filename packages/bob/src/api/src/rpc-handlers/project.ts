/**
 * Effect-RPC handler functions for the project RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  projectCreate,
  projectList,
  projectGet,
  projectUpdateAutomationSettings,
  projectDiscovery,
  projectDismissDir,
} from "../handlers/project.js";

export const makeProjectRpcHandlers = (ctx: HandlerContext) => ({
  "project.create": ({
    payload,
  }: {
    payload: {
      workspaceId: string;
      name: string;
      key: string;
      description?: string;
      color?: string;
    };
  }) => wrapHandler(projectCreate, ctx, payload, "project"),

  "project.list": ({
    payload,
  }: {
    payload: { workspaceId: string };
  }) => wrapHandler(projectList, ctx, payload, "project"),

  "project.get": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(projectGet, ctx, payload, "project"),

  "project.updateAutomationSettings": ({
    payload,
  }: {
    payload: {
      projectId: string;
      settings: {
        autoDispatch?: boolean;
        autoBranch?: boolean;
        autoFeaturePR?: boolean;
        ciTrigger?: boolean;
        reactFrontend?: boolean;
        stageSkills?: Record<
          string,
          Array<{ slug: string; label: string; enabled: boolean }>
        >;
      };
    };
  }) => wrapHandler(projectUpdateAutomationSettings, ctx, payload, "project"),

  "project.discovery": ({
    payload,
  }: {
    payload: { workspaceId: string };
  }) => wrapHandler(projectDiscovery, ctx, payload, "project"),

  "project.dismissDir": ({
    payload,
  }: {
    payload: { dirId: string };
  }) => wrapHandler(projectDismissDir, ctx, payload, "project"),
});

/**
 * Effect-RPC handler functions for the plan session RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 8.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  planSessionCreate,
  planSessionStart,
  planSessionGet,
  planSessionList,
  planSessionListByWorkItem,
  planSessionGetActiveForWorkItem,
  planSessionSaveArtifact,
  planSessionGetPriorContext,
  planSessionCreateDraft,
  planSessionUpdateDraft,
  planSessionRemoveDraft,
  planSessionSetDependency,
  planSessionRemoveDependency,
  planSessionCommitPlan,
  planSessionCommitPlanLocal,
} from "../handlers/planSession.js";

export const makePlanSessionRpcHandlers = (ctx: HandlerContext) => ({
  "planSession.create": ({
    payload,
  }: {
    payload: {
      workspaceId?: string;
      projectId?: string;
      workingDirectory?: string;
      title?: string;
      workItemId?: string;
      planningSessionType?: string;
    };
  }) => wrapHandler(planSessionCreate, ctx, payload, "planSession"),

  "planSession.start": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      workspaceId: string;
      projectId: string;
      projectName: string;
      workingDirectory: string;
      launchContext?: {
        intent: "shape" | "breakdown";
        notes: string;
        workItem?: {
          id: string;
          identifier: string;
          title: string;
          kind: string;
        };
        selectedRepoSources: {
          id: string;
          label: string;
          path: string;
          detail: string;
        }[];
        attachedFiles: {
          name: string;
          sizeLabel: string;
          content?: string;
        }[];
      };
    };
  }) => wrapHandler(planSessionStart, ctx, payload, "planSession"),

  "planSession.get": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(planSessionGet, ctx, payload, "planSession"),

  "planSession.list": ({
    payload,
  }: {
    payload: { workspaceId?: string; limit: number };
  }) => wrapHandler(planSessionList, ctx, payload, "planSession"),

  "planSession.listByWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string; limit: number };
  }) => wrapHandler(planSessionListByWorkItem, ctx, payload, "planSession"),

  "planSession.getActiveForWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(planSessionGetActiveForWorkItem, ctx, payload, "planSession"),

  "planSession.saveArtifact": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      workItemId: string;
      title: string;
      content: string;
      planningSessionType?: string;
    };
  }) => wrapHandler(planSessionSaveArtifact, ctx, payload, "planSession"),

  "planSession.getPriorContext": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      excludeSessionId?: string;
      maxChars: number;
    };
  }) => wrapHandler(planSessionGetPriorContext, ctx, payload, "planSession"),

  "planSession.createDraft": ({
    payload,
  }: {
    payload: Parameters<typeof planSessionCreateDraft>[1];
  }) => wrapHandler(planSessionCreateDraft, ctx, payload, "planDraft"),

  "planSession.updateDraft": ({
    payload,
  }: {
    payload: Parameters<typeof planSessionUpdateDraft>[1];
  }) => wrapHandler(planSessionUpdateDraft, ctx, payload, "planDraft"),

  "planSession.removeDraft": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planSessionRemoveDraft, ctx, payload, "planDraft"),

  "planSession.setDependency": ({
    payload,
  }: {
    payload: { draftId: string; dependsOnDraftId: string };
  }) => wrapHandler(planSessionSetDependency, ctx, payload, "planDraft"),

  "planSession.removeDependency": ({
    payload,
  }: {
    payload: { draftId: string; dependsOnDraftId: string };
  }) => wrapHandler(planSessionRemoveDependency, ctx, payload, "planDraft"),

  "planSession.commitPlan": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(planSessionCommitPlan, ctx, payload, "planSession"),

  "planSession.commitPlanLocal": ({
    payload,
  }: {
    payload: { sessionId: string; parentWorkItemId: string };
  }) => wrapHandler(planSessionCommitPlanLocal, ctx, payload, "planSession"),
});

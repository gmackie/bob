import type { HandlerContext } from "../handlers/context.js";
import {
  agentAuthCancel,
  agentAuthStart,
  agentAuthSubmitCode,
} from "../handlers/agentAuth.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  controlBumpPriority,
  controlRetryItem,
  controlReviewPr,
  controlSetAgentEnabled,
  controlSetBudget,
  controlSetDispatchEnabled,
  controlStopSession,
  controlTriggerReview,
} from "../handlers/cockpitControls.js";
import { cockpitStatus } from "../handlers/cockpitStatus.js";
import { dispatchControlSet } from "../handlers/dispatchControl.js";
import { proxyControlSet } from "../handlers/proxyControl.js";
import { forgegraphImportAllApps } from "../handlers/forgegraph.js";
import {
  planSessionCommitAsChecklist,
  planSessionListArtifacts,
  planSessionListMessages,
  planSessionSendMessage,
  planSessionUpdateArtifact,
} from "../handlers/planSession.js";
import { skillStats } from "../handlers/skill.js";

export const makeOperationsHandlers = (ctx: HandlerContext) => {
  const bind =
    <I, O>(fn: (ctx: HandlerContext, input: I) => Promise<O>) =>
    ({ payload }: { payload: I }) =>
      wrapHandler(fn, ctx, payload, "operation");
  return {
    "cockpit.status": bind((_ctx, input: { includeOoda?: boolean }) =>
      cockpitStatus({
        includeOoda: input.includeOoda ?? false,
        forgejoToken: process.env.BOB_FORGEJO_TOKEN,
        forgejoInstanceUrl:
          process.env.BOB_FORGEJO_INSTANCE_URL ?? "https://git.forgegraf.com",
        rotation: (
          process.env.BOB_AUTO_DRAIN_AGENTS ?? "claude,codex,grok,cursor"
        )
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        repairCap: Number(process.env.BOB_AUTO_REPAIR_MAX_ATTEMPTS_PER_PR ?? 3),
      }),
    ),
    "cockpit.stopSession": bind(controlStopSession),
    "cockpit.retryItem": bind(controlRetryItem),
    "cockpit.bumpPriority": bind(controlBumpPriority),
    "cockpit.setDispatchEnabled": bind(controlSetDispatchEnabled),
    "cockpit.setBudget": bind(controlSetBudget),
    "cockpit.setAgentEnabled": bind(controlSetAgentEnabled),
    "cockpit.triggerReview": bind(controlTriggerReview),
    "cockpit.reviewPr": bind(controlReviewPr),
    "agentAuth.start": bind(
      (ctx, input: Parameters<typeof agentAuthStart>[1]) =>
        agentAuthStart(
          ctx as unknown as Parameters<typeof agentAuthStart>[0],
          input,
        ),
    ),
    "agentAuth.submitCode": bind(
      (ctx, input: Parameters<typeof agentAuthSubmitCode>[1]) =>
        agentAuthSubmitCode(
          ctx as unknown as Parameters<typeof agentAuthSubmitCode>[0],
          input,
        ),
    ),
    "agentAuth.cancel": bind(
      (ctx, input: Parameters<typeof agentAuthCancel>[1]) =>
        agentAuthCancel(
          ctx as unknown as Parameters<typeof agentAuthCancel>[0],
          input,
        ),
    ),
    "dispatchControl.set": bind(
      (ctx, input: Parameters<typeof dispatchControlSet>[1]) =>
        dispatchControlSet(
          ctx as unknown as Parameters<typeof dispatchControlSet>[0],
          input,
        ),
    ),
    "proxyControl.set": bind(
      (ctx, input: Parameters<typeof proxyControlSet>[1]) =>
        proxyControlSet(
          ctx as unknown as Parameters<typeof proxyControlSet>[0],
          input,
        ),
    ),
    "planning.session.listMessages": bind(planSessionListMessages),
    "planning.session.sendMessage": bind(planSessionSendMessage),
    "planning.session.listArtifacts": bind(planSessionListArtifacts),
    "planning.session.updateArtifact": bind(planSessionUpdateArtifact),
    "planning.session.commitAsChecklist": bind(planSessionCommitAsChecklist),
    "planning.skill.stats": bind(skillStats),
    "external.forgegraph.importAllApps": bind(forgegraphImportAllApps),
  };
};

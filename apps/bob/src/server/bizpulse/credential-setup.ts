import { and, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { mcpDispatchApprovals, taskRuns, workItems } from "@bob/db/schema";
import {
  BIZPULSE_CREDENTIAL_SETUP,
  workItemsDispatch,
} from "@bob/api/handlers/workItems";
import { z } from "zod/v4";

import { McpToolError } from "../mcp/errors";
import type { OAuthGrant } from "../mcp/types";
import { assertRotationDestinations, readRotation, requestRotation, rotationReference } from "../llavero/rotation";
import { bizpulseConfig, useClient as withBizPulseClient } from "./client";
import { bizPulseAccess } from "./link";

const uuid = z.uuid();
const stage = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const uuidPattern = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const operationKey = z.string().regex(new RegExp(`^bizpulse:${uuidPattern}:${uuidPattern}$`));
const destination = z.strictObject({
  app: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
  stage,
  key: z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/),
});
export const credentialSetupRequest = z.strictObject({
  operationKey,
  planId: uuid,
  startupId: uuid,
  environment: stage,
  destinations: z.array(destination).min(1).max(30),
  rotation: rotationReference.optional(),
});
export const credentialSetupStatus = z.strictObject({
  operationKey,
  workItemId: uuid,
});
const storedRequest = z.object({
  request: credentialSetupRequest,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  rotationRequestedAt: z.number().int().nonnegative().optional(),
});

type Request = z.infer<typeof credentialSetupRequest>;
type Actor = Pick<OAuthGrant, "userId" | "workspaceId">;
const planMetadata = z.object({
  id: uuid,
  workspaceId: uuid,
  startupId: uuid,
  digest: storedRequest.shape.digest,
  approvedDigest: storedRequest.shape.digest.nullable(),
  approvedBy: z.string().nullable(),
  approvalExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.string(),
  spec: z.object({ environment: stage, steps: z.array(z.unknown()).max(30) }),
});
const deliveryStep = z.object({
  type: z.literal("deliver"),
  app: destination.shape.app,
  stage,
  variable: destination.shape.key,
});

/** Authoritative, live verification using the owner's startup-scoped BizPulse grant. */
async function readPlan(actor: Actor, request: Request) {
  const config = bizpulseConfig();
  const [, workspaceId, plan] = request.operationKey.split(":");
  if (!config || !workspaceId || plan !== request.planId)
    throw new McpToolError("Invalid BizPulse credential setup reference");
  const token = await bizPulseAccess(config, actor.userId, actor.workspaceId);
  if (!token)
    throw new McpToolError("Connect this Bob workspace to BizPulse first");

  const result = await withBizPulseClient(config, token, (client) =>
    client.callTool({
      name: "credential_plan_get",
      arguments: { workspaceId, startupId: request.startupId, planId: request.planId },
    }),
  );
  const text = Array.isArray(result.content)
    ? result.content.find((entry) => entry.type === "text")
    : undefined;
  if (result.isError || text?.type !== "text")
    throw new McpToolError("BizPulse plan is outside the linked startup scope");

  const record = planMetadata.parse(JSON.parse(text.text));
  const expected = record.spec.steps.flatMap((step) => {
    const parsed = deliveryStep.safeParse(step);
    if (!parsed.success) return [];
    const { app, stage, variable } = parsed.data;
    return [{ app, stage, key: variable }];
  });
  if (
    record.id !== request.planId ||
    record.workspaceId !== workspaceId ||
    record.startupId !== request.startupId ||
    record.spec.environment !== request.environment ||
    request.destinations.some((target) => target.stage !== request.environment) ||
    JSON.stringify(expected) !== JSON.stringify(request.destinations)
  ) throw new McpToolError("Destinations no longer match the BizPulse plan");
  return record;
}

function isApproved(record: z.infer<typeof planMetadata>) {
  return Boolean(
    record.approvedBy &&
    record.approvedDigest === record.digest &&
    record.approvalExpiresAt &&
    Date.parse(record.approvalExpiresAt) > Date.now() &&
    ["approved", "waiting"].includes(record.status),
  );
}

function requestDescription(request: Request) {
  const coordinates = request.destinations
    .map(({ app, stage, key }) => `- ${app}/${stage}/${key}`)
    .join("\n");
  const [, workspaceId] = request.operationKey.split(":");
  if (request.rotation) {
    return [
      `Follow approved credential rotation for BizPulse workspace ${workspaceId}, startup ${request.startupId}.`,
      `Bob requested Llavero policy ${request.rotation.org}/${request.rotation.policyId} at digest ${request.rotation.digest}.`,
      `BizPulse plan ${request.planId}. Environment ${request.environment}.`,
      coordinates,
      "Guide the owner through approval and start in Llavero. Use the Bob status reported in BizPulse for the matching run. A delivery acceptance does not verify runtime uptake. Record only references and evidence.",
    ].join("\n\n");
  }
  return [
    `Start approved credential setup for BizPulse workspace ${workspaceId}, startup ${request.startupId}.`,
    `Plan ${request.planId}. Environment ${request.environment}.`,
    coordinates,
    "Use the linked BizPulse and Llavero MCP tools. Recheck the exact plan and required provider approvals before execution. Send the owner to protected intake when needed. Keep credentials out of prompts, work-item data, and tool output. Record only references and delivery evidence.",
  ].join("\n\n");
}

async function readPinnedRotation(actor: Actor, request: Request) {
  if (!request.rotation) return null;
  const status = await readRotation(actor, request.rotation);
  assertRotationDestinations(status, request.rotation, request.destinations);
  return status;
}

export function makeCredentialSetup(db: Db) {
  const externalId = (workspaceId: string, key: string) => `${workspaceId}:${key}`;
  async function find(actor: Actor, query: { key: string } | { id: string }) {
    const row = await db.query.workItems.findFirst({
      where: and(
        eq(workItems.workspaceId, actor.workspaceId),
        eq(workItems.ownerUserId, actor.userId),
        eq(workItems.externalProvider, BIZPULSE_CREDENTIAL_SETUP),
        "key" in query
          ? eq(workItems.externalId, externalId(actor.workspaceId, query.key))
          : eq(workItems.id, query.id),
      ),
    });
    if (!row) throw new McpToolError("Credential setup work item was not found");
    const metadata = storedRequest.parse(row.sourceMetadata.credentialSetup);
    return { row, ...metadata };
  }

  async function approval(actor: Actor, workItemId: string) {
    return db.query.mcpDispatchApprovals.findFirst({
      where: and(
        eq(mcpDispatchApprovals.workItemId, workItemId),
        eq(mcpDispatchApprovals.workspaceId, actor.workspaceId),
        eq(mcpDispatchApprovals.approvedBy, actor.userId),
      ),
    });
  }

  async function statusFor(
    actor: Actor,
    setup: Awaited<ReturnType<typeof find>>,
    plan: z.infer<typeof planMetadata>,
  ) {
    const workItemId = setup.row.id;
    const approved = await approval(actor, workItemId);
    const run = approved?.dispatchedAt
      ? await db.query.taskRuns.findFirst({
          where: and(eq(taskRuns.workItemId, workItemId), eq(taskRuns.userId, actor.userId)),
          columns: { id: true, sessionId: true, status: true },
          orderBy: (row, { desc }) => [desc(row.createdAt)],
        })
      : undefined;
    const result = {
      workItemId,
      operationKey: setup.request.operationKey,
      dispatchApproval: approved?.dispatchedAt ? "dispatched" : approved ? "approved" : "required",
      // The BizPulse approval authorizes this handoff. Llavero's own approval
      // remains required and must be read from the Llavero plan.
      credentialApproval: "required",
      ownerAction:
        plan.digest !== setup.digest || (run && ["failed", "error", "cancelled"].includes(run.status)) ? "reconcile" :
        approved?.dispatchedAt ? "waiting" :
        !isApproved(plan) ? "approve_credentials" : "approve_dispatch",
    };
    if (setup.request.rotation && approved?.dispatchedAt && plan.digest === setup.digest) {
      const pin = setup.request.rotation;
      const state = await readRotation(actor, pin);
      const rotationApproved = state.approvedDigest === pin.digest && state.status === "approved";
      const matching = state.run?.approvedDigest === pin.digest &&
        state.run.requestedAt === setup.rotationRequestedAt ? state.run : null;
      result.credentialApproval = rotationApproved || matching ? "approved" : "required";
      if (matching?.state === "retired") result.ownerAction = "complete";
      else if (matching) {
        result.ownerAction = ["reconciliation-required", "halted", "owner-required"].includes(matching.state)
          ? "reconcile" : "waiting";
      } else if (state.resolvedDigest === pin.digest &&
        state.runRequestedAt !== null && state.runRequestedAt === setup.rotationRequestedAt) {
        result.ownerAction = rotationApproved ? "start_rotation" : "approve_rotation";
      } else result.ownerAction = "reconcile";
      return {
        ...result,
        rotation: { ...pin, requestedAt: setup.rotationRequestedAt, run: matching },
        runId: run?.id,
        runStatus: run?.status,
        sessionId: run?.sessionId ?? undefined,
      };
    }
    const snapshot = setup.request.rotation
      ? { ...result, rotation: { ...setup.request.rotation, run: null } }
      : result;
    return run
      ? {
          ...snapshot,
          runId: run.id,
          runStatus: run.status,
          sessionId: run.sessionId ?? undefined,
        }
      : snapshot;
  }

  return {
    async status(actor: Actor, workItemId: string, key: string) {
      const setup = await find(actor, { id: workItemId });
      if (key !== setup.request.operationKey)
        throw new McpToolError("Credential setup work item was not found");
      return statusFor(actor, setup, await readPlan(actor, setup.request));
    },
    async request(actor: Actor, input: Request) {
      const plan = await readPlan(actor, input);
      if (!isApproved(plan))
        throw new McpToolError("Approve the exact BizPulse setup plan first");
      await readPinnedRotation(actor, input);
      await db.insert(workItems).values({
        workspaceId: actor.workspaceId,
        ownerUserId: actor.userId,
        kind: "task",
        title: `Credential setup · ${input.environment} · ${input.startupId}`,
        description: requestDescription(input),
        status: "draft",
        externalId: externalId(actor.workspaceId, input.operationKey),
        externalProvider: BIZPULSE_CREDENTIAL_SETUP,
        sourceMetadata: { credentialSetup: { request: input, digest: plan.digest } },
      }).onConflictDoNothing();
      const setup = await find(actor, { key: input.operationKey });
      if (setup.digest !== plan.digest || JSON.stringify(setup.request) !== JSON.stringify(input))
        throw new McpToolError("The operation key belongs to a different plan revision");
      return statusFor(actor, setup, plan);
    },
    async review(actor: Actor, workItemId: string) {
      const setup = await find(actor, { id: workItemId });
      const [plan, approved] = await Promise.all([
        readPlan(actor, setup.request),
        approval(actor, workItemId),
      ]);
      return {
        request: setup.request,
        canDispatch: isApproved(plan) && plan.digest === setup.digest && !approved,
        dispatched: Boolean(approved?.dispatchedAt),
      };
    },
    async approveAndDispatch(actor: Actor, workItemId: string) {
      const setup = await find(actor, { id: workItemId });
      const plan = await readPlan(actor, setup.request);
      if (!isApproved(plan) || plan.digest !== setup.digest)
        throw new McpToolError("Approve the current BizPulse plan before dispatch");
      if (setup.request.rotation) {
        if (await approval(actor, workItemId))
          throw new McpToolError("Dispatch was already requested");
        await readPinnedRotation(actor, setup.request);
        const rotationRequestedAt = await requestRotation(actor, setup.request.rotation);
        await db.update(workItems).set({
          sourceMetadata: {
            ...setup.row.sourceMetadata,
            credentialSetup: { request: setup.request, digest: setup.digest, rotationRequestedAt },
          },
        }).where(eq(workItems.id, workItemId));
      }
      const [claim] = await db.insert(mcpDispatchApprovals).values({
        workItemId,
        workspaceId: actor.workspaceId,
        approvedBy: actor.userId,
        dispatchedAt: new Date(),
      }).onConflictDoNothing().returning({ workItemId: mcpDispatchApprovals.workItemId });
      if (!claim) throw new McpToolError("Dispatch was already requested");
      // A lost response is reconciled through the existing run. Never start a
      // second run automatically after claiming the approval.
      return workItemsDispatch(
        { db, userId: actor.userId },
        { workItemId },
        { credentialSetupDescription: requestDescription(setup.request) },
      );
    },
  };
}

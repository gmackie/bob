import { z } from "zod/v4";
import { useClient as withMcpClient } from "../bizpulse/client";
import { McpToolError } from "../mcp/errors";
import type { OAuthGrant } from "../mcp/types";
import { llaveroConfig } from "./client";
import { withLlaveroLink } from "./link";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const time = z.number().int().nonnegative();
const timestamp = z.iso.datetime();
export const rotationReference = z.strictObject({ org: slug, policyId: slug, digest });
type RotationReference = z.infer<typeof rotationReference>;
type Actor = Pick<OAuthGrant, "userId" | "workspaceId">;

const target = z.object({
  app: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
  stage: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  key: z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/),
});
const policyStatus = z.object({
  policyId: slug,
  digest,
  resolvedDigest: digest.nullable(),
  approvedDigest: digest.nullable(),
  status: z.enum(["approved", "proposed", "owner-required", "disabled"]),
  destinations: z.array(z.object({ binding: slug, forgeGraph: target.nullable() })).max(32),
  runRequestedAt: time.nullable(),
  run: z.object({
    id: z.string().regex(/^rrn_[a-z0-9-]{1,64}$/),
    approvedDigest: digest,
    requestedAt: time.nullable(),
    state: z.enum([
      "due", "issuing", "issued", "delivering", "delivered", "verifying",
      "overlap", "retiring", "retired", "reconciliation-required", "halted", "owner-required",
    ]),
    deliveryEvidence: z.array(z.object({ binding: slug, acceptedAt: timestamp })).max(32),
    uptakeVerifiedAt: timestamp.nullable(),
    retiredAt: timestamp.nullable(),
  }).nullable(),
});
type PolicyStatus = z.infer<typeof policyStatus>;

async function call<T>(
  actor: Actor,
  name: "rotation_status" | "rotation_run_request",
  args: { org: string; policyId: string; digest?: string },
  schema: z.ZodType<T>,
) {
  const config = llaveroConfig();
  if (!config) throw new McpToolError("Configure Llavero in Bob");
  const result = await withLlaveroLink(config, actor.userId, actor.workspaceId, (token) =>
    withMcpClient(config, token, (client) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 }),
    ),
  ).catch(() => {
    throw new McpToolError("Llavero could not verify this rotation");
  });
  const content = Array.isArray(result?.content)
    ? result.content.find((part) => part.type === "text")
    : undefined;
  if (!result || result.isError || content?.type !== "text")
    throw new McpToolError("Connect Llavero and grant access to this rotation policy");
  try {
    if (result.structuredContent) return schema.parse(result.structuredContent);
    return schema.parse(JSON.parse(content.text));
  } catch {
    throw new McpToolError("Llavero returned an unsupported rotation status");
  }
}

export async function readRotation(actor: Actor, pin: RotationReference) {
  const { org, policyId } = pin;
  const status = await call(actor, "rotation_status", { org, policyId }, policyStatus);
  if (status.policyId !== pin.policyId) throw new McpToolError("Unexpected rotation policy");
  return status;
}

type Target = z.infer<typeof target>;
export function assertRotationDestinations(
  status: PolicyStatus,
  pin: RotationReference,
  expected: readonly Target[],
) {
  const coordinate = ({ app, stage, key }: Target) => [app, stage, key].join("/");
  const actual = status.destinations.flatMap(({ forgeGraph }) =>
    forgeGraph ? [coordinate(forgeGraph)] : [],
  );
  if (status.digest !== pin.digest || status.resolvedDigest !== pin.digest ||
    !["approved", "proposed"].includes(status.status) ||
    actual.length !== status.destinations.length ||
    JSON.stringify(actual.sort()) !== JSON.stringify(expected.map(coordinate).sort()))
    throw new McpToolError("Llavero rotation does not match the reviewed digest and destinations");
}

export async function requestRotation(actor: Actor, pin: RotationReference) {
  const result = await call(actor, "rotation_run_request", pin, z.object({
    policyId: slug,
    runRequestedAt: time,
  }));
  if (result.policyId !== pin.policyId) throw new McpToolError("Unexpected rotation policy");
  return result.runRequestedAt;
}

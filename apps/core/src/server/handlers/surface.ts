import { RpcGroup, type Rpc } from "effect/unstable/rpc";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";

function select<R extends Rpc.Any, const T extends ReadonlyArray<R["_tag"]>>(
  group: RpcGroup.RpcGroup<R>,
  ...tags: T
) {
  return RpcGroup.make(
    ...tags.map(
      (tag) =>
        group.requests.get(tag)! as Extract<R, { readonly _tag: T[number] }>,
    ),
  );
}
export const ReferenceAuthRpc = select(
  AuthRpc,
  "auth.whoAmI",
  "auth.listMemberships",
  "auth.resolveTenant",
  "auth.issueApiKey",
  "auth.listApiKeys",
  "auth.revokeApiKey",
  "auth.startDeviceFlow",
  "auth.pollDeviceCode",
  "auth.approveDeviceCode",
);
export const ReferenceAgentRpc = select(
  AgentRpc,
  "agent.createSession",
  "agent.sendTurn",
  "agent.cancelSession",
  "agent.closeSession",
  "agent.getTranscript",
);
export const ReferenceProjectsRpc = select(
  ProjectsRpc,
  "projects.create",
  "projects.list",
  "projects.getBySlug",
  "projects.delete",
);
export const ReferenceSecretsRpc = select(
  SecretsRpc,
  "secrets.create",
  "secrets.list",
  "secrets.getEnvelope",
  "secrets.decryptForUse",
  "secrets.markUsed",
  "secrets.delete",
);

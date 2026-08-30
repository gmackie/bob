// Projects facade for @gmacko/client. Mirrors ProjectsRpc — 4 procedures.

import { Effect } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import type { ProjectWire } from "@gmacko/core/contracts/schemas/projects";

import type { ClientRuntime } from "./internal/runtime.js";

export interface ProjectsClient {
  readonly create: (input: {
    readonly slug: string;
    readonly name: string;
  }) => Promise<ProjectWire>;
  /**
   * Scoped to a workspace: the handler gates access with
   * `assertWorkspaceAccess(workspaceId)` before querying. This took no
   * argument while the contract said `Schema.Void`, so the payload reached
   * the handler as `undefined` and it crashed on `input.workspaceId`.
   */
  readonly list: (input: {
    readonly workspaceId: string;
  }) => Promise<ReadonlyArray<ProjectWire>>;
  readonly getBySlug: (input: {
    readonly slug: string;
  }) => Promise<ProjectWire>;
  readonly delete: (input: {
    readonly projectId: string;
  }) => Promise<void>;
}

type AnyRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Effect.Effect<unknown, unknown, unknown>;
type OpaqueClient = Record<string, AnyRpcFn>;

export const makeProjectsClient = (runtime: ClientRuntime): ProjectsClient => {
  const invoke = <A>(tag: string, payload?: unknown): Promise<A> =>
    runtime.runEffect(
      Effect.flatMap(RpcClient.make(ProjectsRpc), (client) => {
        const fn = (client as unknown as OpaqueClient)[tag]!;
        return fn(payload) as Effect.Effect<A, unknown, never>;
      }) as Effect.Effect<A, unknown, never>,
    );

  return {
    create: (input) => invoke<ProjectWire>("projects.create", input),
    list: (input) => invoke<ReadonlyArray<ProjectWire>>("projects.list", input),
    getBySlug: (input) => invoke<ProjectWire>("projects.getBySlug", input),
    delete: (input) => invoke<void>("projects.delete", input),
  };
};

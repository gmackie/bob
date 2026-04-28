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
  readonly list: () => Promise<ReadonlyArray<ProjectWire>>;
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
    list: () => invoke<ReadonlyArray<ProjectWire>>("projects.list"),
    getBySlug: (input) => invoke<ProjectWire>("projects.getBySlug", input),
    delete: (input) => invoke<void>("projects.delete", input),
  };
};

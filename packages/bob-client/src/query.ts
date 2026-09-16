import type {
  UseMutationOptions,
  UseQueryOptions,
} from "@tanstack/react-query";
import { Effect } from "effect";
import { RpcClient, type Rpc, type RpcGroup } from "effect/unstable/rpc";
import {
  OperationsRpc,
  NativeRpc,
  ExternalRpc,
  PlanningRpc,
  WorkItemsRpc,
} from "@gmacko/bob/contracts";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";
import { SettingsRpc } from "@gmacko/core/contracts/groups/settings";
import { makeRuntime, type ClientRuntimeOptions } from "./internal/runtime.js";

type AllProcedures = RpcGroup.Rpcs<
  | typeof OperationsRpc
  | typeof NativeRpc
  | typeof WorkItemsRpc
  | typeof PlanningRpc
  | typeof ExternalRpc
  | typeof AgentRpc
  | typeof AuthRpc
  | typeof ProjectsRpc
  | typeof SecretsRpc
  | typeof SettingsRpc
>;
const BobRpc: RpcGroup.RpcGroup<AllProcedures> = WorkItemsRpc.merge(
  NativeRpc,
  OperationsRpc,
  PlanningRpc,
  ExternalRpc,
  AgentRpc,
  AuthRpc,
  ProjectsRpc,
  SecretsRpc,
  SettingsRpc,
);
type Unary<R> = R extends Rpc.Any
  ? Rpc.Success<R> extends import("effect").Stream.Stream<
      unknown,
      unknown,
      unknown
    >
    ? never
    : R
  : never;
type Procedures = Unary<RpcGroup.Rpcs<typeof BobRpc>>;
export type BobRpcTag = Procedures["_tag"];
type Procedure<T extends BobRpcTag> = Extract<Procedures, { readonly _tag: T }>;
export type BobRpcInput<T extends BobRpcTag> = Rpc.Payload<Procedure<T>>;
export type BobRpcOutput<T extends BobRpcTag> = Rpc.Success<Procedure<T>>;

export interface BobProcedure<T extends BobRpcTag> {
  queryKey(
    input?: Partial<BobRpcInput<T>>,
  ): readonly ["rpc", T, ...Partial<BobRpcInput<T>>[]];
  queryFilter(input?: Partial<BobRpcInput<T>>): {
    queryKey: readonly ["rpc", T, ...Partial<BobRpcInput<T>>[]];
  };
  queryOptions<Selected = BobRpcOutput<T>>(
    input: BobRpcInput<T>,
    opts?: Omit<
      UseQueryOptions<BobRpcOutput<T>, Error, Selected>,
      "queryKey" | "queryFn"
    >,
  ): UseQueryOptions<BobRpcOutput<T>, Error, Selected>;
  mutationOptions<Context = unknown>(
    opts?: Omit<
      UseMutationOptions<BobRpcOutput<T>, Error, BobRpcInput<T>, Context>,
      "mutationKey" | "mutationFn"
    >,
  ): UseMutationOptions<BobRpcOutput<T>, Error, BobRpcInput<T>, Context>;
  call(input: BobRpcInput<T>, signal?: AbortSignal): Promise<BobRpcOutput<T>>;
}
export type BobQueryClient = <T extends BobRpcTag>(tag: T) => BobProcedure<T>;

/** Contract-derived React Query options. No server/router types enter the app. */
export function createBobQueryClient(
  options: ClientRuntimeOptions,
): BobQueryClient {
  const runtime = makeRuntime(options);
  const procedures = new Map<BobRpcTag, unknown>();
  return <T extends BobRpcTag>(tag: T) => {
    const cached = procedures.get(tag) as BobProcedure<T> | undefined;
    if (cached) return cached;
    type Input = BobRpcInput<T>;
    type Output = BobRpcOutput<T>;
    const queryKey = (input?: Partial<Input>) =>
      input === undefined
        ? (["rpc", tag] as const)
        : (["rpc", tag, input] as const);
    const invoke = (input: Input, signal?: AbortSignal): Promise<Output> =>
      runtime.runEffect(
        Effect.flatMap(RpcClient.make(BobRpc), (client) => {
          // The generic tag and payload are correlated above. TS cannot retain
          // that correlation when indexing a mapped client with a union key.
          const call = client[tag] as unknown as (
            payload: Input,
          ) => Effect.Effect<Output, unknown>;
          return call(input);
        }),
        signal,
      );
    const procedure: BobProcedure<T> = {
      queryKey,
      queryFilter: (input?: Partial<Input>) => ({ queryKey: queryKey(input) }),
      queryOptions: <Selected = Output>(
        input: Input,
        opts?: Omit<
          UseQueryOptions<Output, Error, Selected>,
          "queryKey" | "queryFn"
        >,
      ) => ({
        ...opts,
        queryKey: queryKey(input),
        queryFn: ({ signal }) => invoke(input, signal),
      }),
      mutationOptions: <Context = unknown>(
        opts?: Omit<
          UseMutationOptions<Output, Error, Input, Context>,
          "mutationKey" | "mutationFn"
        >,
      ) => ({
        ...opts,
        mutationKey: ["rpc", tag] as const,
        mutationFn: (input: Input) => invoke(input),
      }),
      call: invoke,
    };
    procedures.set(tag, procedure);
    return procedure;
  };
}

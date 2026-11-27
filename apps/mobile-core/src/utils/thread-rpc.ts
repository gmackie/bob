import { Effect, Layer, Option } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import {
  GmackoRpcGroup,
  type ExplorationDirection,
  type ExplorationSummary,
} from "@gmacko/core/contracts";

function exploration(summary: ExplorationSummary) {
  return {
    ...summary,
    lastCheckIn:
      summary.lastCheckIn && Option.getOrUndefined(summary.lastCheckIn),
  };
}

// The thread service mounts GmackoRpcGroup at /rpc with JSON serialization.
export function createThreadRpc(url: string, fetchImpl: typeof fetch = fetch) {
  const transport = RpcClient.layerProtocolHttp({
    url,
    transformClient: (client) =>
      HttpClient.mapRequest(
        client,
        HttpClientRequest.setHeader("x-rpc-source", "expo"),
      ),
  }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)),
      ),
    ),
  );
  const service = RpcClient.make(GmackoRpcGroup);
  const call = <A, E>(
    request: (client: Effect.Success<typeof service>) => Effect.Effect<A, E>,
  ) =>
    Effect.runPromise(
      Effect.flatMap(service, request).pipe(
        Effect.scoped,
        Effect.provide(transport),
      ),
    );

  return {
    threads: {
      list: () => call((c) => c["threads.list"]({})),
      byId: (id: string) => call((c) => c["threads.byId"]({ id })),
      create: (input: { title: string; tags?: string[] }) =>
        call((c) => c["threads.create"]({ ...input, tags: input.tags ?? [] })),
    },
    messages: {
      listByBranch: (threadId: string, branchId: string) =>
        call((c) => c["messages.listByBranch"]({ threadId, branchId })),
    },
    agent: {
      chat: (input: { threadId: string; branchId: string; content: string }) =>
        call((c) => c["agent.chat"](input)),
    },
    wiki: { list: () => call((c) => c["wiki.list"]({})) },
    exploration: {
      start: (input: {
        threadId: string;
        branchId: string;
        topic: string;
        maxDepth?: number;
      }) =>
        call((c) =>
          c["exploration.start"]({ ...input, maxDepth: input.maxDepth ?? 5 }),
        ).then(exploration),
      respond: (input: {
        explorationId: string;
        checkInId: string;
        direction: ExplorationDirection;
        redirectTopic?: string;
      }) =>
        call((c) =>
          c["exploration.respond"]({
            ...input,
            redirectTopic: Option.fromNullishOr(input.redirectTopic),
          }),
        ).then(exploration),
      status: (explorationId: string) =>
        call((c) => c["exploration.status"]({ explorationId })).then(
          exploration,
        ),
      list: () =>
        call((c) => c["exploration.list"]({})).then((items) =>
          items.map(exploration),
        ),
    },
  };
}

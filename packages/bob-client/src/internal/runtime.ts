import { Effect, Layer, Stream, type Scope } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

export type ClientRuntimeSerialization = "json" | "ndjson";

export interface ClientRuntimeOptions {
  readonly baseURL: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Record<string, string>;
  readonly serialization?: ClientRuntimeSerialization;
}

export interface ClientRuntime {
  readonly runEffect: <A, E>(
    effect: Effect.Effect<A, E, Scope.Scope | RpcClient.Protocol>,
  ) => Promise<A>;
  readonly runStream: <A, E>(
    streamEffect: Effect.Effect<
      Stream.Stream<A, E>,
      never,
      Scope.Scope | RpcClient.Protocol
    >,
  ) => AsyncIterable<A>;
}

const buildTransportLayer = (opts: ClientRuntimeOptions) => {
  const protocolLayer = RpcClient.layerProtocolHttp({
    url: opts.baseURL,
    transformClient: opts.headers
      ? (client) =>
          HttpClient.mapRequest(client, (request) =>
            HttpClientRequest.setHeaders(request, opts.headers!),
          )
      : undefined,
  });

  const serializationLayer =
    (opts.serialization ?? "ndjson") === "ndjson"
      ? RpcSerialization.layerNdjson
      : RpcSerialization.layerJson;

  const fetchLayer: Layer.Layer<HttpClient.HttpClient> = opts.fetch
    ? FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, opts.fetch)),
      )
    : FetchHttpClient.layer;

  return protocolLayer.pipe(
    Layer.provide(serializationLayer),
    Layer.provide(fetchLayer),
  );
};

export const makeRuntime = (opts: ClientRuntimeOptions): ClientRuntime => {
  const transport = buildTransportLayer(opts);

  const runEffect = <A, E>(
    effect: Effect.Effect<A, E, Scope.Scope | RpcClient.Protocol>,
  ): Promise<A> =>
    Effect.runPromise(
      (
        effect.pipe(Effect.scoped, Effect.provide(transport)) as Effect.Effect<
          A,
          E,
          never
        >
      ),
    );

  const runStream = <A, E>(
    streamEffect: Effect.Effect<
      Stream.Stream<A, E>,
      never,
      Scope.Scope | RpcClient.Protocol
    >,
  ): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const elements = await Effect.runPromise(
        (
          Effect.flatMap(streamEffect, (stream) =>
            Stream.runCollect(stream),
          ).pipe(
            Effect.scoped,
            Effect.provide(transport),
          ) as Effect.Effect<ReadonlyArray<A>, E, never>
        ),
      );
      for (const event of elements) {
        yield event;
      }
    },
  });

  return { runEffect, runStream };
};

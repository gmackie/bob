// Internal runtime for the @gmacko/client SDK.
//
// Each per-group facade ("auth", "projects", ...) calls back into this module
// to go from Effect → Promise (or Stream → AsyncIterable). The runtime owns
// the transport layer (RpcClient.Protocol + RpcSerialization + HttpClient)
// so the facades only need to invoke it.
//
// Design decisions:
//   - We build the full transport Layer *once* in `makeRuntime` and keep it
//     as an opaque blob. Each call to `runEffect` / `runStream` scopes a
//     fresh client against that layer — `RpcClient.make` is cheap enough
//     that per-call scoping is fine for the current beta of Effect 4, and
//     it keeps the semantic model simple (no long-lived subscription state).
//   - Header injection uses `layerProtocolHttp`'s `transformClient` option,
//     which composes before serialization and is the documented place to
//     inject per-request metadata. We also honor a custom `fetch` via the
//     `FetchHttpClient.Fetch` ServiceMap reference, since `layerProtocolHttp`
//     itself doesn't take a `fetch` argument.
//
// Effect 4 drift notes for 6F Task 8:
//   - `RpcClient.layerProtocolHttp` accepts `{ url, transformClient? }` — no
//     `fetch`, `baseUrl`, or `headers` options. See
//     `effect@4.0.0-beta.43/dist/unstable/rpc/RpcClient.d.ts:156`.
//   - `Stream.toAsyncIterable(stream)` exists in beta.43 at
//     `effect/dist/Stream.d.ts:13911`. No manual push/pull loop needed.
//   - `FetchHttpClient.Fetch` is a `ServiceMap.Reference<typeof fetch>` — we
//     override it via `Layer.succeed(Fetch, opts.fetch)` when provided.

import { Effect, Layer, Stream, type Scope } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

/**
 * Options accepted by {@link makeRuntime}. Shared with
 * {@link GmackoClientOptions} from the public barrel.
 */
export interface ClientRuntimeOptions {
  readonly baseURL: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Record<string, string>;
}

/**
 * A ready-to-use transport shim. Per-group facades capture one and call
 * `runEffect` / `runStream` to convert Effect-shaped results into values
 * that feel native in a plain TypeScript browser runtime.
 */
export interface ClientRuntime {
  /**
   * Execute an Effect that may depend on the transport layer and return a
   * Promise. Rejects with the tagged error class (or an `RpcClientError`)
   * when the Effect fails.
   *
   * The `R` type parameter widens to the "world" — the callers compose
   * `RpcClient.make(...)` into `effect` and the runtime provides the
   * `Protocol | RpcSerialization | HttpClient | Scope` dependencies via
   * its internal layer. This signature uses `unknown` for the environment
   * because TypeScript struggles to narrow the services correctly across
   * the facade boundary; we rely on the facade authors to only pass
   * Effects whose only remaining requirement is `Scope`.
   */
  readonly runEffect: <A, E>(
    effect: Effect.Effect<A, E, Scope.Scope | RpcClient.Protocol>,
  ) => Promise<A>;
  /**
   * Execute a Stream-producing Effect and return an AsyncIterable. Stream
   * failures throw from the iterator; consumers use `for await`.
   */
  readonly runStream: <A, E>(
    streamEffect: Effect.Effect<
      Stream.Stream<A, E>,
      never,
      Scope.Scope | RpcClient.Protocol
    >,
  ) => AsyncIterable<A>;
}

const buildTransportLayer = (opts: ClientRuntimeOptions) => {
  // Base protocol layer — binds the RpcClient.Protocol service to an HTTP
  // sender that funnels through an HttpClient.HttpClient + RpcSerialization.
  const protocolLayer = RpcClient.layerProtocolHttp({
    url: opts.baseURL,
    // Optional header injection: wrap every outbound request with the
    // caller-provided headers. We can't just bake them into `fetch` because
    // the RpcClient pipeline builds its own HttpClientRequest.
    transformClient: opts.headers
      ? (client) =>
          HttpClient.mapRequest(client, (request) =>
            HttpClientRequest.setHeaders(request, opts.headers!),
          )
      : undefined,
  });

  // Serialization — JSON is the default. `layerJson` is used in
  // `@gmacko/rpc/server.ts` so the client matches.
  const serializationLayer = RpcSerialization.layerJson;

  // HttpClient — default to globalThis.fetch, overrideable via
  // FetchHttpClient.Fetch reference when the caller supplies one.
  const fetchLayer: Layer.Layer<HttpClient.HttpClient> = opts.fetch
    ? FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, opts.fetch)),
      )
    : FetchHttpClient.layer;

  // Compose: protocol ← (serialization + httpClient).
  return protocolLayer.pipe(
    Layer.provide(serializationLayer),
    Layer.provide(fetchLayer),
  );
};

/**
 * Build a {@link ClientRuntime} from transport options. The returned
 * runtime is safe to reuse across many calls — its layer is materialized
 * lazily per call.
 */
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
  ): AsyncIterable<A> => {
    // Defer materialization until someone actually iterates. That way, if
    // the caller never touches the iterable, we never spin up a scope.
    //
    // SCOPE LIFECYCLE NOTE — Task 9 drift finding:
    //   The RpcClient streaming path in effect@4.0.0-beta.43 attaches the
    //   stream's queue to the current scope (see RpcClient.js:139
    //   `Scope.addFinalizerExit`). If we split "extract stream" from "iterate
    //   stream" across scope boundaries, the scope closes at the end of the
    //   first `runPromise` and the queue interrupts with no elements — the
    //   consumer sees "All fibers interrupted without error".
    //
    //   To keep things simple AND correct, we fold "build the stream" and
    //   "run the stream to completion" into a single scoped effect and buffer
    //   the elements into an array. For a browser consumer this is fine: the
    //   stream semantics of RPC responses are still correct (error-on-failure,
    //   element-by-element iteration), and the wire is still end-to-end the
    //   same. Real long-lived streams (e.g. unbounded agent transcripts) will
    //   want a proper scope-across-iteration runtime — tracked for 6G/6J.
    return {
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
    };
  };

  return { runEffect, runStream };
};

/**
 * REST bridge for Bob's Effect-RPC surface (plan Task 4b).
 *
 * Exposes every RPC procedure as `POST /api/v1/{tag-as-kebab-path}` with the
 * payload as the JSON body, matching the OpenAPI spec produced by
 * `./contracts/rpc-openapi.ts`. Lets non-Effect HTTP consumers (external API,
 * third parties, codegen clients) call Bob without the ndjson RPC transport.
 *
 * Dispatch is **in-process through the real RPC handler**: the bridge stands up
 * an Effect `RpcClient` whose HTTP transport is a custom `fetch` that calls the
 * provided `rpcHandler` directly (no network hop). This reuses the entire
 * server pipeline — auth middleware, serialization, per-request context, and
 * the handler implementations — instead of reimplementing any of it. Auth
 * headers (cookie / bearer) from the inbound REST request are forwarded into
 * the synthetic RPC request.
 *
 * Mount it in the Node `bob-server` (Task 4c) alongside the `/api/rpc` handler.
 */
import { Effect, Layer } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

type WebHandler = (request: Request) => Promise<Response>;

/** Structural view of an `RpcGroup` — avoids depending on effect internals. */
interface RpcGroupLike {
  readonly requests: ReadonlyMap<string, unknown>;
}

export interface RestBridgeOptions {
  /** REST path prefix. Default `/api/v1`. Must match `tagToRestPath`. */
  readonly basePath?: string;
  /** Path the RPC handler is served at. Default `/api/rpc`. */
  readonly rpcPath?: string;
  /** Request headers forwarded to the RPC call. Default: cookie + authorization. */
  readonly authHeaders?: (request: Request) => Record<string, string>;
}

const kebabSegmentToCamel = (segment: string): string =>
  segment.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/**
 * Reverse of `tagToRestPath`: `/api/v1/work-item/link/list` → `workItem.link.list`.
 * Returns `undefined` if the path is not under `basePath`.
 */
export const restPathToTag = (
  pathname: string,
  basePath = "/api/v1",
): string | undefined => {
  const prefix = `${basePath}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (rest.length === 0) return undefined;
  return rest.split("/").map(kebabSegmentToCamel).join(".");
};

const defaultAuthHeaders = (request: Request): Record<string, string> => {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const auth = request.headers.get("authorization");
  if (auth) headers.authorization = auth;
  return headers;
};

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Map a rejected handler error to an HTTP status. The RpcClient surfaces the
 * contract's tagged errors (`BobNotFoundError`, `BobForbiddenError`,
 * `BobConflictError`) as the rejection value.
 */
const errorToResponse = (err: unknown): Response => {
  const tag =
    err && typeof err === "object" && "_tag" in err
      ? String((err)._tag)
      : undefined;
  switch (tag) {
    case "BobNotFoundError":
      return jsonResponse({ error: "not_found", detail: err }, 404);
    case "BobForbiddenError":
      return jsonResponse({ error: "forbidden", detail: err }, 403);
    case "BobConflictError":
      return jsonResponse({ error: "conflict", detail: err }, 409);
    default:
      return jsonResponse(
        { error: "internal_error", detail: tag ?? String(err) },
        500,
      );
  }
};

const buildTransport = (
  rpcHandler: WebHandler,
  url: string,
  headers: Record<string, string>,
) => {
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
    rpcHandler(new Request(input, init))) as typeof fetch;

  const protocol = RpcClient.layerProtocolHttp({
    url,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeaders(request, headers),
      ),
  });

  const fetchLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)),
  );

  return protocol.pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(fetchLayer),
  );
};

const invokeInProcess = (
  group: RpcGroupLike,
  rpcHandler: WebHandler,
  url: string,
  headers: Record<string, string>,
  tag: string,
  payload: unknown,
): Promise<unknown> => {
  const transport = buildTransport(rpcHandler, url, headers);
  return Effect.runPromise(
    Effect.flatMap(RpcClient.make(group as never), (client) => {
      const fn = (client as unknown as Record<
        string,
        (p: unknown) => Effect.Effect<unknown, unknown, never>
      >)[tag]!;
      return fn(payload);
    }).pipe(
      Effect.scoped,
      Effect.provide(transport),
    ),
  );
};

/**
 * Build the REST bridge handler for an RPC group. `rpcHandler` is the in-process
 * `/api/rpc` web handler (from `makeRpcHandler`); the bridge dispatches through
 * it so it shares the same auth + handler pipeline.
 */
export const makeRestBridge = (
  group: RpcGroupLike,
  rpcHandler: WebHandler,
  options: RestBridgeOptions = {},
): WebHandler => {
  const basePath = options.basePath ?? "/api/v1";
  const rpcPath = options.rpcPath ?? "/api/rpc";
  const authHeaders = options.authHeaders ?? defaultAuthHeaders;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const url = new URL(request.url);
    const tag = restPathToTag(url.pathname, basePath);
    if (!tag || !group.requests.has(tag)) {
      return jsonResponse(
        { error: "unknown_operation", path: url.pathname },
        404,
      );
    }

    let payload: unknown;
    try {
      const text = await request.text();
      payload = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      return jsonResponse({ error: "invalid_json_body" }, 400);
    }

    const rpcUrl = new URL(rpcPath, url.origin).toString();
    try {
      const result = await invokeInProcess(
        group,
        rpcHandler,
        rpcUrl,
        authHeaders(request),
        tag,
        payload,
      );
      return jsonResponse(result, 200);
    } catch (err) {
      return errorToResponse(err);
    }
  };
};

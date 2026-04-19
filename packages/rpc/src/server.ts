import type { Layer } from "effect";
import {
  Rpc,
  RpcGroup,
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";

// Build a Layer that serves a given RpcGroup over HTTP.
// Apps compose this with their auth/db/realtime layers and must provide
// HttpRouter.HttpRouter, RpcSerialization.RpcSerialization (see
// serializationLayer below), and handler layers for every rpc in the group.
export const makeRpcServerLayer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | RpcSerialization.RpcSerialization
  | Rpc.ToHandler<Rpcs>
  | Rpc.Middleware<Rpcs>
  | Rpc.ServicesServer<Rpcs>
> =>
  RpcServer.layerHttp({
    group,
    path: "/rpc",
    protocol: "http",
  });

export const serializationLayer = RpcSerialization.layerJson;

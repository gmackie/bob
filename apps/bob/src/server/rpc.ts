import "server-only";

import { makeRpcHandler } from "@bob/api/rpc-server";

import { runtimeLayer, authMiddlewareLayer } from "./layers.js";

// The Effect-RPC server assembly (BobRpcGroup + handlers) lives in the shared
// `@bob/api/rpc-server` module. This file supplies Bob's app-local runtime/auth
// layers and runs natively at the Cloudflare Workers edge: `effect/unstable/rpc`
// bundles for Workers (with nodejs_compat + the vite node:fs/node:os/pg-native
// stubs) and the ndjson dispatch + auth middleware were verified end-to-end on
// workerd. The route is served at `/api/rpc` via the optional catch-all
// `app/api/rpc/[[...rpc]]/route.ts`.
const rpcHandler = makeRpcHandler({ runtimeLayer, authMiddlewareLayer });

export { rpcHandler };

import "server-only";

import { makeRpcHandler } from "@bob/api/rpc-server";

import { runtimeLayer, authMiddlewareLayer } from "./layers.js";

// The Effect-RPC server assembly (BobRpcGroup + handlers) now lives in the
// shared `@bob/api/rpc-server` module so it can also be hosted from the Node
// `bob-server`. This file just supplies Bob's app-local runtime/auth layers.
//
// NOTE: in the Cloudflare Workers build, `apps/bob/vite.config.ts` aliases
// `~/server/rpc` to `src/lib/rpc-stub.ts` (501) because effect/unstable/rpc
// can't bundle for Workers — so this real handler only runs in dev/Node.
const rpcHandler = makeRpcHandler({ runtimeLayer, authMiddlewareLayer });

export { rpcHandler };

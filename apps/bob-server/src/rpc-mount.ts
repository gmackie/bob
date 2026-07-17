import { createAuthRuntime } from "@bob/auth/runtime";
import { db } from "@bob/db/client";
import * as bobSchema from "@bob/db/schema";

import { makeBobRuntimeLayers } from "@bob/api/runtime-layers";
import { makeBobRestBridge, makeRpcHandler } from "@bob/api/rpc-server";

// ---------------------------------------------------------------------------
// Node host for Bob's Effect-RPC surface (plan Task 4c, part 2).
//
// The CF Workers edge build stubs /api/rpc (effect/unstable/rpc can't bundle
// for Workers), so the real Effect-RPC transport + REST bridge are hosted here
// in the Node bob-server. This is OPT-IN: only active when BOB_SERVER_HOST_RPC
// is "true", so default bob-server behavior (pure reverse proxy) is unchanged
// until the deploy supplies the required auth/db env.
// ---------------------------------------------------------------------------

export interface RpcMount {
  readonly rpcHandler: (request: Request) => Promise<Response>;
  readonly restBridge: (request: Request) => Promise<Response>;
}

export function isRpcHostEnabled(): boolean {
  return process.env.BOB_SERVER_HOST_RPC === "true";
}

const safeOrigin = (input: string): string => {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
};

let cached: RpcMount | undefined;

/**
 * Build (once) the Node-hosted RPC handler + REST bridge. Constructs Bob's
 * better-auth runtime from env (mirrors `apps/bob/src/auth/server.ts`, minus the
 * Next-only `getSession` wrapper) and the Effect runtime layers, then assembles
 * the `/api/rpc` handler and the `/api/v1/*` REST bridge over the same pipeline.
 */
export function getRpcMount(): RpcMount {
  if (cached) return cached;

  const baseUrl = safeOrigin(
    process.env.FRONTEND_URL ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "http://localhost:5173",
  );

  const authBundle = createAuthRuntime({
    db,
    schema: bobSchema as unknown as Record<string, unknown>,
    pluralizeTables: true,
    baseUrl,
    productionUrl: baseUrl,
    secret: process.env.AUTH_SECRET ?? "",
    githubClientId: process.env.AUTH_GITHUB_ID ?? "",
    githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
    githubScopes: ["user:email", "repo", "read:user"],
    googleClientId: process.env.AUTH_GOOGLE_ID,
    googleClientSecret: process.env.AUTH_GOOGLE_SECRET,
    trustedOrigins: [
      "https://blder.bot",
      "https://bob.blder.bot",
      ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
    ],
  });

  const layers = makeBobRuntimeLayers({
    db,
    authInstance: authBundle.authInstance,
  });

  const rpcHandler = makeRpcHandler(layers);
  const restBridge = makeBobRestBridge(rpcHandler);

  cached = { rpcHandler, restBridge };
  return cached;
}

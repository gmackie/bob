import "server-only";
import { readTrustedLocalFilesystemConfig } from "@bob/api/handlers/trusted-local-filesystem";

import { makeBobRuntimeLayers } from "@bob/api/runtime-layers";

import { db } from "@bob/db/client";
import { authBundle } from "~/auth/server";

// The layer composition now lives in the Next-free @bob/api/runtime-layers
// builder so the Node bob-server can reuse it (Task 4c). This file just supplies
// Bob's app-local db + better-auth instance — the latter via ~/auth/server,
// which pulls in next/headers and so stays app-local.
const { runtimeLayer, authMiddlewareLayer } = makeBobRuntimeLayers({
  db,
  authInstance: authBundle.authInstance,
  localFilesystem: readTrustedLocalFilesystemConfig(process.env),
});

export { runtimeLayer, authMiddlewareLayer };

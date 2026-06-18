/**
 * Effect-RPC handler functions for the filesystem RPCs.
 *
 * All operations are NOT_IMPLEMENTED — the Go daemon now owns file access.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 6.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  filesystemList,
  filesystemRead,
  filesystemWrite,
  filesystemDelete,
  filesystemMkdir,
  filesystemMove,
  filesystemCopy,
  filesystemSearch,
  filesystemGitStatus,
} from "../handlers/filesystem.js";

export const makeFilesystemRpcHandlers = (ctx: HandlerContext) => ({
  "filesystem.list": () =>
    wrapHandler(filesystemList, ctx, undefined as never, "filesystem"),

  "filesystem.read": () =>
    wrapHandler(filesystemRead, ctx, undefined as never, "filesystem"),

  "filesystem.write": () =>
    wrapHandler(filesystemWrite, ctx, undefined as never, "filesystem"),

  "filesystem.delete": () =>
    wrapHandler(filesystemDelete, ctx, undefined as never, "filesystem"),

  "filesystem.mkdir": () =>
    wrapHandler(filesystemMkdir, ctx, undefined as never, "filesystem"),

  "filesystem.move": () =>
    wrapHandler(filesystemMove, ctx, undefined as never, "filesystem"),

  "filesystem.copy": () =>
    wrapHandler(filesystemCopy, ctx, undefined as never, "filesystem"),

  "filesystem.search": () =>
    wrapHandler(filesystemSearch, ctx, undefined as never, "filesystem"),

  "filesystem.gitStatus": () =>
    wrapHandler(filesystemGitStatus, ctx, undefined as never, "filesystem"),
});

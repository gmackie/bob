/**
 * Effect-RPC handler functions for the filesystem RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 */
import type { HandlerContext } from "../handlers/context.js";
import type {
  FilesystemCopyInput,
  FilesystemDeleteInput,
  FilesystemGitStatusInput,
  FilesystemListInput,
  FilesystemMkdirInput,
  FilesystemMoveInput,
  FilesystemReadInput,
  FilesystemSearchInput,
  FilesystemWriteInput,
} from "../handlers/filesystem.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  filesystemCopy,
  filesystemDelete,
  filesystemGitStatus,
  filesystemList,
  filesystemMkdir,
  filesystemMove,
  filesystemRead,
  filesystemSearch,
  filesystemWrite,
} from "../handlers/filesystem.js";

export const makeFilesystemRpcHandlers = (ctx: HandlerContext) => ({
  "filesystem.list": (input: FilesystemListInput) =>
    wrapHandler(filesystemList, ctx, input, "filesystem"),

  "filesystem.read": (input: FilesystemReadInput) =>
    wrapHandler(filesystemRead, ctx, input, "filesystem"),

  "filesystem.write": (input: FilesystemWriteInput) =>
    wrapHandler(filesystemWrite, ctx, input, "filesystem"),

  "filesystem.delete": (input: FilesystemDeleteInput) =>
    wrapHandler(filesystemDelete, ctx, input, "filesystem"),

  "filesystem.mkdir": (input: FilesystemMkdirInput) =>
    wrapHandler(filesystemMkdir, ctx, input, "filesystem"),

  "filesystem.move": (input: FilesystemMoveInput) =>
    wrapHandler(filesystemMove, ctx, input, "filesystem"),

  "filesystem.copy": (input: FilesystemCopyInput) =>
    wrapHandler(filesystemCopy, ctx, input, "filesystem"),

  "filesystem.search": (input: FilesystemSearchInput) =>
    wrapHandler(filesystemSearch, ctx, input, "filesystem"),

  "filesystem.gitStatus": (input: FilesystemGitStatusInput) =>
    wrapHandler(filesystemGitStatus, ctx, input, "filesystem"),
});

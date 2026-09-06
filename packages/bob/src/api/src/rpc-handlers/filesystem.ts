/**
 * Effect-RPC handler functions for the filesystem RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapAuthorizedHandler`, and returns an Effect value.
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
import { wrapAuthorizedHandler } from "../handlers/authorized-rpc.js";
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
    wrapAuthorizedHandler(filesystemList, ctx, input, "filesystem"),

  "filesystem.read": (input: FilesystemReadInput) =>
    wrapAuthorizedHandler(filesystemRead, ctx, input, "filesystem"),

  "filesystem.write": (input: FilesystemWriteInput) =>
    wrapAuthorizedHandler(filesystemWrite, ctx, input, "filesystem"),

  "filesystem.delete": (input: FilesystemDeleteInput) =>
    wrapAuthorizedHandler(filesystemDelete, ctx, input, "filesystem"),

  "filesystem.mkdir": (input: FilesystemMkdirInput) =>
    wrapAuthorizedHandler(filesystemMkdir, ctx, input, "filesystem"),

  "filesystem.move": (input: FilesystemMoveInput) =>
    wrapAuthorizedHandler(filesystemMove, ctx, input, "filesystem"),

  "filesystem.copy": (input: FilesystemCopyInput) =>
    wrapAuthorizedHandler(filesystemCopy, ctx, input, "filesystem"),

  "filesystem.search": (input: FilesystemSearchInput) =>
    wrapAuthorizedHandler(filesystemSearch, ctx, input, "filesystem"),

  "filesystem.gitStatus": (input: FilesystemGitStatusInput) =>
    wrapAuthorizedHandler(filesystemGitStatus, ctx, input, "filesystem"),
});

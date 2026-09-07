import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  lstat,
  realpath,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { devNull } from "node:os";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";

import type { HandlerContext } from "./context.js";

const execFileAsync = promisify(execFile);

const SEARCH_MAX_FILE_BYTES = 1024 * 1024;
const SEARCH_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  ".cache",
  ".turbo",
]);

export interface FilesystemListInput {
  path: string;
  showHidden?: boolean;
}

export interface FilesystemReadInput {
  path: string;
  encoding?: "utf-8" | "base64";
}

export interface FilesystemWriteInput {
  path: string;
  content: string;
  createDirs?: boolean;
}

export interface FilesystemDeleteInput {
  path: string;
  recursive?: boolean;
}

export interface FilesystemMkdirInput {
  path: string;
  recursive?: boolean;
}

export interface FilesystemMoveInput {
  source: string;
  destination: string;
}

export interface FilesystemCopyInput {
  source: string;
  destination: string;
}

export interface FilesystemSearchInput {
  path: string;
  pattern: string;
  maxResults?: number;
}

export interface FilesystemGitStatusInput {
  path: string;
}

export interface FilesystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
  modifiedAt: string;
}

export interface FilesystemSearchResult {
  path: string;
  matches: {
    line: number;
    content: string;
  }[];
}

export interface FilesystemGitStatusEntry {
  path: string;
  file: string;
  status: string;
}

function asUtf8(value: string | Buffer | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function ensurePath(ctx: HandlerContext, value: string, field = "path"): Promise<string> {
  if (ctx.filesystem?.kind !== "local-operator" || ctx.filesystem.userId !== ctx.userId || !ctx.filesystem.roots.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Local operator filesystem capability required" });
  }
  if (!value.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: `${field} must not be empty` });
  const candidate = path.resolve(value);
  for (const trusted of ctx.filesystem.roots) {
    const lexicalRoot = path.resolve(trusted);
    const root = await realpath(lexicalRoot);
    const relative = within(lexicalRoot, candidate) ? path.relative(lexicalRoot, candidate)
      : within(root, candidate) ? path.relative(root, candidate) : null;
    if (relative === null) continue;
    // Resolve the trusted root once, then reject symlinks at every component,
    // including dangling links and a destination's nearest existing parent.
    let current = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Filesystem symlink traversal is not allowed" });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return path.join(root, relative);
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Path is outside the local operator roots" });
}

async function requireMutablePath(ctx: HandlerContext, value: string): Promise<string> {
  const result = await ensurePath(ctx, value);
  const authority = ctx.filesystem;
  if (!authority) throw new TRPCError({ code: "FORBIDDEN", message: "Local filesystem authority is required" });
  for (const root of authority.roots) {
    if (result === await realpath(root)) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot replace or remove an operator root" });
  }
  return result;
}

function mapFsError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const err = error as NodeJS.ErrnoException;
  if (err.code === "ENOENT") {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err.code === "EACCES" || err.code === "EPERM") {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  }
  if (
    err.code === "ENOTDIR" ||
    err.code === "EISDIR" ||
    err.code === "ENOTEMPTY" ||
    err.code === "EINVAL"
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err.message,
  });
}

async function toEntry(
  parentPath: string,
  name: string,
): Promise<FilesystemEntry | null> {
  const entryPath = path.join(parentPath, name);
  const info = await lstat(entryPath);
  if (info.isSymbolicLink()) return null;
  const modified = info.mtime.toISOString();
  return {
    name,
    path: entryPath,
    isDirectory: info.isDirectory(),
    isFile: info.isFile(),
    size: info.size,
    modified,
    modifiedAt: modified,
  };
}

export async function filesystemList(
  _ctx: HandlerContext,
  input: FilesystemListInput,
): Promise<FilesystemEntry[]> {
  try {
    const directoryPath = await ensurePath(_ctx, input.path);
    const names = await readdir(directoryPath);
    const visibleNames = input.showHidden
      ? names
      : names.filter((name) => !name.startsWith("."));

    const entries = await Promise.all(
      visibleNames.map((name) => toEntry(directoryPath, name)),
    );

    return entries.filter((entry): entry is FilesystemEntry => entry !== null).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  } catch (error) {
    mapFsError(error);
  }
}

export async function filesystemRead(
  _ctx: HandlerContext,
  input: FilesystemReadInput,
): Promise<{ content: string }> {
  try {
    const filePath = await ensurePath(_ctx, input.path);
    const buffer = await readFile(filePath);
    return {
      content:
        input.encoding === "base64"
          ? buffer.toString("base64")
          : buffer.toString("utf8"),
    };
  } catch (error) {
    mapFsError(error);
  }
}

export async function filesystemWrite(
  _ctx: HandlerContext,
  input: FilesystemWriteInput,
): Promise<{ success: true }> {
  try {
    const filePath = await ensurePath(_ctx, input.path);
    if (input.createDirs !== false) {
      await mkdir(path.dirname(filePath), { recursive: true });
    }
    await writeFile(filePath, input.content, "utf8");
    return { success: true };
  } catch (error) {
    mapFsError(error);
  }
}

export async function filesystemDelete(
  _ctx: HandlerContext,
  input: FilesystemDeleteInput,
): Promise<{ success: true }> {
  try {
    await rm(await requireMutablePath(_ctx, input.path), {
      recursive: input.recursive === true,
      force: false,
    });
    return { success: true };
  } catch (error) {
    mapFsError(error);
  }
}

export async function filesystemMkdir(
  _ctx: HandlerContext,
  input: FilesystemMkdirInput,
): Promise<{ success: true }> {
  try {
    await mkdir(await ensurePath(_ctx, input.path), {
      recursive: input.recursive !== false,
    });
    return { success: true };
  } catch (error) {
    mapFsError(error);
  }
}

export async function filesystemMove(
  _ctx: HandlerContext,
  input: FilesystemMoveInput,
): Promise<{ success: true }> {
  try {
    const source = await requireMutablePath(_ctx, input.source);
    const destination = await requireMutablePath(_ctx, input.destination);
    await requireUnlinkedTree(source);
    await requireUnlinkedTree(destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    return { success: true };
  } catch (error) {
    mapFsError(error);
  }
}

async function requireUnlinkedTree(value: string): Promise<void> {
  let info;
  try { info = await lstat(value); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink()) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot copy or move a tree containing symlinks" });
  if (info.isDirectory()) {
    for (const child of await readdir(value)) await requireUnlinkedTree(path.join(value, child));
  }
}

export async function filesystemCopy(
  _ctx: HandlerContext,
  input: FilesystemCopyInput,
): Promise<{ success: true }> {
  try {
    const source = await requireMutablePath(_ctx, input.source);
    const destination = await requireMutablePath(_ctx, input.destination);
    await requireUnlinkedTree(source);
    await requireUnlinkedTree(destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    mapFsError(error);
  }
}

async function searchFile(
  filePath: string,
  pattern: string,
): Promise<FilesystemSearchResult | null> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size > SEARCH_MAX_FILE_BYTES) return null;

  const content = await readFile(filePath, "utf8");
  const matches = content
    .split(/\r?\n/)
    .flatMap((line, index) =>
      line.includes(pattern) ? [{ line: index + 1, content: line }] : [],
    );

  return matches.length > 0 ? { path: filePath, matches } : null;
}

async function walkSearch(
  rootPath: string,
  pattern: string,
  maxResults: number,
  results: FilesystemSearchResult[],
): Promise<void> {
  if (results.length >= maxResults) return;

  const info = await lstat(rootPath);
  if (info.isSymbolicLink()) return;
  if (info.isFile()) {
    const result = await searchFile(rootPath, pattern);
    if (result) results.push(result);
    return;
  }
  if (!info.isDirectory()) return;

  const names = await readdir(rootPath);
  for (const name of names) {
    if (results.length >= maxResults) return;
    if (name.startsWith(".") || SEARCH_IGNORED_DIRS.has(name)) continue;
    await walkSearch(path.join(rootPath, name), pattern, maxResults, results);
  }
}

export async function filesystemSearch(
  _ctx: HandlerContext,
  input: FilesystemSearchInput,
): Promise<FilesystemSearchResult[]> {
  if (!input.pattern) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "pattern must not be empty",
    });
  }

  try {
    const results: FilesystemSearchResult[] = [];
    await walkSearch(
      await ensurePath(_ctx, input.path),
      input.pattern,
      input.maxResults ?? 100,
      results,
    );
    return results;
  } catch (error) {
    mapFsError(error);
  }
}

function parseGitStatusLine(line: string): FilesystemGitStatusEntry | null {
  if (line.length < 4) return null;

  const x = line[0] ?? " ";
  const y = line[1] ?? " ";
  const rawPath = line.slice(3);
  const file = rawPath.includes(" -> ")
    ? (rawPath.split(" -> ").at(-1) ?? rawPath)
    : rawPath;

  let status = "modified";
  if (x === "?" && y === "?") status = "??";
  else if (x === "D" || y === "D") status = "D";
  else if (x === "A" || y === "A") status = "A";
  else if (x === "R" || y === "R") status = "R";
  else if (x === "C" || y === "C") status = "C";
  else if (x === "M" || y === "M") status = "M";

  return { path: file, file, status };
}

export async function filesystemGitStatus(
  _ctx: HandlerContext,
  input: FilesystemGitStatusInput,
): Promise<FilesystemGitStatusEntry[]> {
  try {
    const rootPath = await ensurePath(_ctx, input.path);
    await access(rootPath, constants.R_OK);
    // Status must not discover a parent checkout or follow a worktree's Git
    // metadata outside the grant. Disable executable fsmonitor hooks and
    // ambient Git path overrides before inspecting repository metadata.
    const gitEnv = { ...process.env };
    for (const key of Object.keys(gitEnv)) {
      if (key.startsWith("GIT_")) delete gitEnv[key];
    }
    Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_COUNT: "0", GIT_OPTIONAL_LOCKS: "0" });
    const args = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", rootPath];
    const { stdout: locations } = await execFileAsync("git", [...args, "rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], { env: gitEnv, maxBuffer: 1024 * 1024 });
    const directories = asUtf8(locations).trim().split(/\r?\n/);
    for (const directory of directories) await ensurePath(_ctx, directory);
    for (const directory of directories.slice(1)) await requireUnlinkedTree(directory);
    const { stdout } = await execFileAsync(
      "git", [...args, "status", "--porcelain=v1", "--untracked-files=all"],
      { env: gitEnv, maxBuffer: 1024 * 1024 },
    );
    const output = asUtf8(stdout);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseGitStatusLine)
      .filter((entry): entry is FilesystemGitStatusEntry => entry !== null);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    if (err.code === "ENOENT") mapFsError(error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        asUtf8(err.stderr).trim() || err.message || "Failed to read git status",
    });
  }
}

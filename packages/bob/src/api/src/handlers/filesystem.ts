import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
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

function ensurePath(value: string, field = "path"): string {
  if (!value.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${field} must not be empty`,
    });
  }
  return path.resolve(value);
}

function mapFsError(error: unknown): never {
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
): Promise<FilesystemEntry> {
  const entryPath = path.join(parentPath, name);
  const info = await stat(entryPath);
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
    const directoryPath = ensurePath(input.path);
    const names = await readdir(directoryPath);
    const visibleNames = input.showHidden
      ? names
      : names.filter((name) => !name.startsWith("."));

    const entries = await Promise.all(
      visibleNames.map((name) => toEntry(directoryPath, name)),
    );

    return entries.sort((a, b) => {
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
    const filePath = ensurePath(input.path);
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
    const filePath = ensurePath(input.path);
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
    await rm(ensurePath(input.path), {
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
    await mkdir(ensurePath(input.path), {
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
    const source = ensurePath(input.source, "source");
    const destination = ensurePath(input.destination, "destination");
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    return { success: true };
  } catch (error) {
    mapFsError(error);
  }
}

export async function filesystemCopy(
  _ctx: HandlerContext,
  input: FilesystemCopyInput,
): Promise<{ success: true }> {
  try {
    const source = ensurePath(input.source, "source");
    const destination = ensurePath(input.destination, "destination");
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

  const info = await stat(rootPath);
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
      ensurePath(input.path),
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
    const rootPath = ensurePath(input.path);
    await access(rootPath, constants.R_OK);
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootPath, "status", "--porcelain=v1", "--untracked-files=all"],
      { maxBuffer: 1024 * 1024 },
    );
    const output = asUtf8(stdout);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseGitStatusLine)
      .filter((entry): entry is FilesystemGitStatusEntry => entry !== null);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    if (err.code === "ENOENT") mapFsError(error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        asUtf8(err.stderr).trim() || err.message || "Failed to read git status",
    });
  }
}

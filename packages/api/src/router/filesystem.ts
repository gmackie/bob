import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

const MAX_READ_BYTES = 10 * 1024 * 1024;
const SKIPPED_SEARCH_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
]);

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
};

type GitStatusCode = "M" | "A" | "D" | "??" | "R" | "C";

function toTRPCError(error: unknown, fallbackMessage: string): TRPCError {
  if (error instanceof TRPCError) return error;

  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === "ENOENT") {
    return new TRPCError({ code: "NOT_FOUND", message: "Path not found" });
  }
  if (nodeError?.code === "EACCES" || nodeError?.code === "EPERM") {
    return new TRPCError({
      code: "FORBIDDEN",
      message: "Filesystem access denied",
    });
  }
  if (nodeError?.code === "ENOTDIR") {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Path is not a directory",
    });
  }
  if (nodeError?.code === "EISDIR") {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Path is a directory",
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: nodeError?.message || fallbackMessage,
  });
}

function assertAbsolutePath(inputPath: string): string {
  if (!path.isAbsolute(inputPath)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Filesystem paths must be absolute",
    });
  }

  return path.resolve(inputPath);
}

async function statFile(absPath: string) {
  try {
    return await fs.stat(absPath);
  } catch (error) {
    throw toTRPCError(error, "Unable to stat path");
  }
}

async function listDirectory(
  absPath: string,
  showHidden: boolean,
): Promise<FileEntry[]> {
  try {
    const names = await fs.readdir(absPath);
    const entries = await Promise.all(
      names
        .filter((name) => showHidden || !name.startsWith("."))
        .map(async (name) => {
          const entryPath = path.join(absPath, name);
          const stat = await fs.stat(entryPath);
          return {
            name,
            path: entryPath,
            isDirectory: stat.isDirectory(),
            isFile: stat.isFile(),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        }),
    );

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  } catch (error) {
    throw toTRPCError(error, "Unable to list directory");
  }
}

async function searchFiles(
  rootPath: string,
  pattern: string,
  maxResults: number,
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  const normalizedPattern = pattern.toLowerCase();
  const queue = [rootPath];

  while (queue.length > 0 && results.length < maxResults) {
    const currentDir = queue.shift()!;
    let entries: FileEntry[];

    try {
      entries = await listDirectory(currentDir, true);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      if (entry.isDirectory) {
        if (!SKIPPED_SEARCH_DIRS.has(entry.name)) {
          queue.push(entry.path);
        }
        continue;
      }

      if (!entry.isFile) continue;

      const nameMatches = entry.name.toLowerCase().includes(normalizedPattern);
      if (nameMatches) {
        results.push(entry);
        continue;
      }

      if (entry.size > MAX_READ_BYTES) continue;

      try {
        const content = await fs.readFile(entry.path, "utf-8");
        if (content.toLowerCase().includes(normalizedPattern)) {
          results.push(entry);
        }
      } catch {
        // Skip binary or unreadable files.
      }
    }
  }

  return results;
}

function parseGitStatus(
  output: string,
): Array<{ file: string; status: GitStatusCode }> {
  const statuses: Array<{ file: string; status: GitStatusCode }> = [];
  const fields = output.split("\0").filter(Boolean);

  for (let i = 0; i < fields.length; i += 1) {
    const record = fields[i]!;
    const xy = record.slice(0, 2);
    let file = record.slice(3);

    if (xy.startsWith("R") || xy.startsWith("C")) {
      i += 1;
      file = fields[i] ?? file;
    }

    let status: GitStatusCode | null = null;
    if (xy === "??") status = "??";
    else if (xy.includes("D")) status = "D";
    else if (xy.includes("A")) status = "A";
    else if (xy.includes("R")) status = "R";
    else if (xy.includes("C")) status = "C";
    else if (xy.trim()) status = "M";

    if (status && file) {
      statuses.push({ file, status });
    }
  }

  return statuses;
}

async function getGitStatus(absPath: string) {
  try {
    const { execFile } = await import("node:child_process");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "git",
      ["-C", absPath, "status", "--porcelain=v1", "-z"],
      { maxBuffer: 1024 * 1024 },
    );
    return parseGitStatus(stdout);
  } catch {
    return [];
  }
}

export const filesystemRouter = {
  list: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        showHidden: z.boolean().default(false),
      }),
    )
    .query(async ({ input }) =>
      listDirectory(assertAbsolutePath(input.path), input.showHidden),
    ),

  read: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
      }),
    )
    .query(async ({ input }) => {
      const absPath = assertAbsolutePath(input.path);
      const stat = await statFile(absPath);
      if (!stat.isFile()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Path is not a file",
        });
      }
      if (stat.size > MAX_READ_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `File exceeds ${MAX_READ_BYTES} bytes`,
        });
      }

      try {
        return {
          content:
            input.encoding === "base64"
              ? await fs.readFile(absPath, "base64")
              : await fs.readFile(absPath, "utf-8"),
          encoding: input.encoding,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      } catch (error) {
        throw toTRPCError(error, "Unable to read file");
      }
    }),

  write: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        content: z.string(),
        createDirs: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const absPath = assertAbsolutePath(input.path);
      try {
        if (input.createDirs) {
          await fs.mkdir(path.dirname(absPath), { recursive: true });
        }
        await fs.writeFile(absPath, input.content, "utf-8");
        const stat = await fs.stat(absPath);
        return {
          path: absPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      } catch (error) {
        throw toTRPCError(error, "Unable to write file");
      }
    }),

  delete: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const absPath = assertAbsolutePath(input.path);
      try {
        await fs.rm(absPath, { recursive: input.recursive, force: false });
        return { deleted: true };
      } catch (error) {
        throw toTRPCError(error, "Unable to delete path");
      }
    }),

  mkdir: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const absPath = assertAbsolutePath(input.path);
      try {
        await fs.mkdir(absPath, { recursive: input.recursive });
        return { path: absPath, created: true };
      } catch (error) {
        throw toTRPCError(error, "Unable to create directory");
      }
    }),

  move: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const source = assertAbsolutePath(input.source);
      const destination = assertAbsolutePath(input.destination);
      try {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rename(source, destination);
        return { source, destination, moved: true };
      } catch (error) {
        throw toTRPCError(error, "Unable to move path");
      }
    }),

  copy: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const source = assertAbsolutePath(input.source);
      const destination = assertAbsolutePath(input.destination);
      try {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(source, destination, { recursive: true });
        return { source, destination, copied: true };
      } catch (error) {
        throw toTRPCError(error, "Unable to copy path");
      }
    }),

  search: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        pattern: z.string().min(1),
        maxResults: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(async ({ input }) =>
      searchFiles(
        assertAbsolutePath(input.path),
        input.pattern,
        input.maxResults,
      ),
    ),

  gitStatus: protectedProcedure
    .input(
      z.object({
        path: z.string(),
      }),
    )
    .query(async ({ input }) => getGitStatus(assertAbsolutePath(input.path))),
} satisfies TRPCRouterRecord;

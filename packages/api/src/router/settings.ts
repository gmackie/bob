import { createHash, randomBytes } from "crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, isNull } from "@bob/db";
import {
  apiKeys,
  UpdateUserPreferencesSchema,
  userPreferences,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

const CONFIG_ROOT_IDS = [
  "opencode_xdg",
  "opencode_dot",
  "claude_dot",
  "codex_dot",
  "gemini_dot",
  "kiro_dot",
  "cursor_agent_dot",
] as const;

type ConfigRootId = (typeof CONFIG_ROOT_IDS)[number];

function getConfigRootDir(rootId: ConfigRootId): string {
  const homeDir = os.homedir();

  switch (rootId) {
    case "opencode_xdg":
      return path.join(homeDir, ".config", "opencode");
    case "opencode_dot":
      return path.join(homeDir, ".opencode");
    case "claude_dot":
      return path.join(homeDir, ".claude");
    case "codex_dot":
      return path.join(homeDir, ".codex");
    case "gemini_dot":
      return path.join(homeDir, ".gemini");
    case "kiro_dot":
      return path.join(homeDir, ".kiro");
    case "cursor_agent_dot":
      return path.join(homeDir, ".cursor-agent");
  }
}

function normalizeRelativePath(p: string): string {
  // Force relative, forbid traversal.
  // - normalize converts things like a/b/../c
  // - strip any leading slashes to prevent absolute paths
  const normalized = path.posix
    .normalize(p.replaceAll("\\", "/"))
    .replace(/^\/+/, "");

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Path traversal is not allowed");
  }

  return normalized;
}

function resolveUnderRoot(rootDir: string, relPath: string): string {
  const rel = normalizeRelativePath(relPath);
  const abs = path.resolve(rootDir, rel);
  const rootAbs = path.resolve(rootDir);
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;

  if (abs !== rootAbs && !abs.startsWith(rootWithSep)) {
    throw new Error("Path is outside allowed root");
  }

  return abs;
}

function generateApiKey(): string {
  return `gmk_${randomBytes(32).toString("base64url")}`;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function getKeyPrefix(key: string): string {
  return key.substring(0, 12);
}

export const settingsRouter = {
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await ctx.db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, ctx.session.user.id),
    });

    if (!prefs) {
      const [newPrefs] = await ctx.db
        .insert(userPreferences)
        .values({ userId: ctx.session.user.id })
        .returning();
      return newPrefs;
    }

    return prefs;
  }),

  updatePreferences: protectedProcedure
    .input(UpdateUserPreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.userPreferences.findFirst({
        where: eq(userPreferences.userId, ctx.session.user.id),
      });

      if (!existing) {
        const [newPrefs] = await ctx.db
          .insert(userPreferences)
          .values({ userId: ctx.session.user.id, ...input })
          .returning();
        return newPrefs;
      }

      const [updated] = await ctx.db
        .update(userPreferences)
        .set(input)
        .where(eq(userPreferences.userId, ctx.session.user.id))
        .returning();

      return updated;
    }),

  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.userId, ctx.session.user.id),
        isNull(apiKeys.revokedAt),
      ),
      columns: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: (keys, { desc }) => [desc(keys.createdAt)],
    });

    return keys;
  }),

  createApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        permissions: z
          .array(z.enum(["read", "write", "delete", "admin"]))
          .min(1),
        expiresInDays: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = generateApiKey();
      const keyHash = hashApiKey(key);
      const keyPrefix = getKeyPrefix(key);

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const [created] = await ctx.db
        .insert(apiKeys)
        .values({
          userId: ctx.session.user.id,
          name: input.name,
          keyHash,
          keyPrefix,
          permissions: input.permissions,
          expiresAt,
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          permissions: apiKeys.permissions,
          expiresAt: apiKeys.expiresAt,
        });

      return {
        ...created,
        key,
      };
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [revoked] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, input.id),
            eq(apiKeys.userId, ctx.session.user.id),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });

      return { success: !!revoked };
    }),

  listConfigRoots: protectedProcedure.query(async () => {
    const roots: Array<{ id: ConfigRootId; label: string; dir: string }> = [
      { id: "opencode_xdg", label: "OpenCode (XDG config)", dir: getConfigRootDir("opencode_xdg") },
      { id: "opencode_dot", label: "OpenCode (.opencode)", dir: getConfigRootDir("opencode_dot") },
      { id: "claude_dot", label: "Claude (.claude)", dir: getConfigRootDir("claude_dot") },
      { id: "codex_dot", label: "Codex (.codex)", dir: getConfigRootDir("codex_dot") },
      { id: "gemini_dot", label: "Gemini (.gemini)", dir: getConfigRootDir("gemini_dot") },
      { id: "kiro_dot", label: "Kiro (.kiro)", dir: getConfigRootDir("kiro_dot") },
      { id: "cursor_agent_dot", label: "Cursor Agent (.cursor-agent)", dir: getConfigRootDir("cursor_agent_dot") },
    ];

    // Best-effort existence check.
    const withExists = await Promise.all(
      roots.map(async (r) => {
        try {
          const st = await fs.stat(r.dir);
          return { ...r, exists: st.isDirectory() };
        } catch {
          return { ...r, exists: false };
        }
      }),
    );

    return withExists;
  }),

  listConfigEntries: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        dir: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const rootDir = getConfigRootDir(input.rootId);
      const targetDir = resolveUnderRoot(rootDir, input.dir ?? "");

      // Ensure root exists; if it doesn't, return empty.
      try {
        const st = await fs.stat(targetDir);
        if (!st.isDirectory()) {
          return { rootDir, dir: input.dir ?? "", entries: [] as any[] };
        }
      } catch {
        return { rootDir, dir: input.dir ?? "", entries: [] as any[] };
      }

      const names = await fs.readdir(targetDir);
      const entries = await Promise.all(
        names.map(async (name) => {
          const absPath = path.join(targetDir, name);
          const st = await fs.stat(absPath);
          const relPath = path
            .relative(rootDir, absPath)
            .split(path.sep)
            .join("/");
          return {
            name,
            path: relPath,
            isDir: st.isDirectory(),
            size: st.isFile() ? st.size : null,
            mtimeMs: st.mtimeMs,
          };
        }),
      );

      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { rootDir, dir: input.dir ?? "", entries };
    }),

  readConfigFile: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        path: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const rootDir = getConfigRootDir(input.rootId);
      const absPath = resolveUnderRoot(rootDir, input.path);

      const st = await fs.stat(absPath);
      if (!st.isFile()) {
        throw new Error("Not a file");
      }

      const MAX_BYTES = 1024 * 1024;
      if (st.size > MAX_BYTES) {
        throw new Error(`File too large (> ${MAX_BYTES} bytes)`);
      }

      const content = await fs.readFile(absPath, "utf-8");
      return {
        rootDir,
        path: input.path,
        size: st.size,
        mtimeMs: st.mtimeMs,
        content,
      };
    }),

  writeConfigFile: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        path: z.string(),
        content: z.string(),
        createOnly: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const rootDir = getConfigRootDir(input.rootId);
      const absPath = resolveUnderRoot(rootDir, input.path);

      const parentDir = path.dirname(absPath);
      await fs.mkdir(parentDir, { recursive: true });

      if (input.createOnly) {
        try {
          await fs.stat(absPath);
          throw new Error("File already exists");
        } catch (err) {
          // ok if not exists
          if (err instanceof Error && err.message === "File already exists") {
            throw err;
          }
        }
      }

      const ext = path.extname(absPath).toLowerCase();
      if (ext === ".json") {
        try {
          JSON.parse(input.content);
        } catch {
          throw new Error("Invalid JSON");
        }
      }

      await fs.writeFile(absPath, input.content, "utf-8");
      const st = await fs.stat(absPath);

      return {
        rootDir,
        path: input.path,
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    }),

  deleteConfigFile: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        path: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const rootDir = getConfigRootDir(input.rootId);
      const absPath = resolveUnderRoot(rootDir, input.path);

      const st = await fs.stat(absPath);
      if (!st.isFile()) {
        throw new Error("Not a file");
      }

      await fs.unlink(absPath);
      return { success: true };
    }),
} satisfies TRPCRouterRecord;

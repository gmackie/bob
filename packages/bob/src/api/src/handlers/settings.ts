/**
 * Settings handler functions — pure business logic extracted from the
 * tRPC settings router.
 *
 * Phase 7B-4D-beta Task 7.
 */
import { createHash, randomBytes } from "crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { and, eq, isNull, sql } from "@bob/db";
import {
  apiKeys,
  gitProviderConnections,
  userPreferences,
} from "@bob/db/schema";

import {
  encryptToken,
  isEncryptionConfigured,
} from "../services/crypto/tokenVault";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CONFIG_ROOT_IDS = [
  "opencode_xdg",
  "opencode_dot",
  "claude_dot",
  "codex_dot",
  "gemini_dot",
  "kiro_dot",
  "cursor_agent_dot",
] as const;

export type ConfigRootId = (typeof CONFIG_ROOT_IDS)[number];

export function getConfigRootDir(rootId: ConfigRootId): string {
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

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function settingsGetPreferences(ctx: HandlerContext) {
  const prefs = await ctx.db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, ctx.userId),
  });

  if (!prefs) {
    const [newPrefs] = await ctx.db
      .insert(userPreferences)
      .values({ userId: ctx.userId })
      .returning();
    return newPrefs;
  }

  return prefs;
}

export async function settingsUpdatePreferences(
  ctx: HandlerContext,
  input: Record<string, unknown>,
) {
  const existing = await ctx.db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, ctx.userId),
  });

  if (!existing) {
    const [newPrefs] = await ctx.db
      .insert(userPreferences)
      .values({ userId: ctx.userId, ...input })
      .returning();
    return newPrefs;
  }

  const [updated] = await ctx.db
    .update(userPreferences)
    .set(input)
    .where(eq(userPreferences.userId, ctx.userId))
    .returning();

  return updated;
}

export async function settingsListApiKeys(ctx: HandlerContext) {
  const keys = await ctx.db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.userId, ctx.userId),
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
    orderBy: (keys: any, { desc }: any) => [desc(keys.createdAt)],
  });

  return keys;
}

export async function settingsCreateApiKey(
  ctx: HandlerContext,
  input: {
    name: string;
    permissions: ("read" | "write" | "delete" | "admin")[];
    expiresInDays?: number;
  },
) {
  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = getKeyPrefix(key);

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const [created] = await ctx.db
    .insert(apiKeys)
    .values({
      userId: ctx.userId,
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
}

export async function settingsRevokeApiKey(
  ctx: HandlerContext,
  input: { id: string },
) {
  const [revoked] = await ctx.db
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(apiKeys.id, input.id),
        eq(apiKeys.userId, ctx.userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  return { success: !!revoked };
}

export async function settingsListConfigRoots() {
  const roots: { id: ConfigRootId; label: string; dir: string }[] = [
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
}

export async function settingsListConfigEntries(
  _ctx: HandlerContext,
  input: { rootId: ConfigRootId; dir?: string },
) {
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
}

export async function settingsReadConfigFile(
  _ctx: HandlerContext,
  input: { rootId: ConfigRootId; path: string },
) {
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
}

export async function settingsWriteConfigFile(
  _ctx: HandlerContext,
  input: { rootId: ConfigRootId; path: string; content: string; createOnly?: boolean },
) {
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
}

export async function settingsDeleteConfigFile(
  _ctx: HandlerContext,
  input: { rootId: ConfigRootId; path: string },
) {
  const rootDir = getConfigRootDir(input.rootId);
  const absPath = resolveUnderRoot(rootDir, input.path);

  const st = await fs.stat(absPath);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }

  await fs.unlink(absPath);
  return { success: true };
}

export async function settingsGetForgeGraphConnection(ctx: HandlerContext) {
  const connection = await ctx.db.query.gitProviderConnections.findFirst({
    where: and(
      eq(gitProviderConnections.userId, ctx.userId),
      eq(gitProviderConnections.provider, "forgegraph"),
      isNull(gitProviderConnections.revokedAt),
    ),
    columns: {
      id: true,
      providerUsername: true,
      createdAt: true,
    },
  });

  return connection ?? null;
}

export async function settingsConnectForgeGraph(
  ctx: HandlerContext,
  input: { apiToken: string },
) {
  if (!isEncryptionConfigured()) {
    throw new Error(
      "Token encryption not configured (GIT_TOKEN_ENCRYPTION_KEY)",
    );
  }

  const fgServer =
    process.env.FORGEGRAPH_URL ??
    process.env.FG_API_URL ??
    "https://forgegraf.com";
  const resp = await fetch(`${fgServer}/api/fg/apps`, {
    headers: { Authorization: `Bearer ${input.apiToken}` },
  });

  if (!resp.ok) {
    throw new Error("Invalid ForgeGraph API token");
  }

  const fgUser = { login: "forgegraph", id: 0 };

  await ctx.db
    .update(gitProviderConnections)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(gitProviderConnections.userId, ctx.userId),
        eq(gitProviderConnections.provider, "forgegraph"),
        isNull(gitProviderConnections.revokedAt),
      ),
    );

  const connectionId = crypto.randomUUID();
  const encrypted = encryptToken(input.apiToken, connectionId);

  await ctx.db.insert(gitProviderConnections).values({
    id: connectionId,
    userId: ctx.userId,
    provider: "forgegraph",
    instanceUrl: fgServer,
    providerAccountId: String(fgUser.id ?? "unknown"),
    providerUsername: fgUser.login ?? null,
    accessTokenCiphertext: encrypted.ciphertext,
    accessTokenIv: encrypted.iv,
    accessTokenTag: encrypted.tag,
    scopes: "api",
  });

  return {
    id: connectionId,
    providerUsername: fgUser.login ?? null,
  };
}

export async function settingsDisconnectForgeGraph(ctx: HandlerContext) {
  await ctx.db
    .update(gitProviderConnections)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(gitProviderConnections.userId, ctx.userId),
        eq(gitProviderConnections.provider, "forgegraph"),
        isNull(gitProviderConnections.revokedAt),
      ),
    );
  return { success: true };
}

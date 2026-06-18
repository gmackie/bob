// Deterministic stub handlers for the Settings RPC contract group.
//
// Covers all 20 procedures across general settings (13), cookies (5),
// and system (2). All IDs and timestamps are fixed for golden-style
// test stability.
import { DateTime, Effect } from "effect";

import { SettingsRpc } from "../groups/settings.js";
import type { UserPreferencesWire } from "../schemas/settings-general.js";

// --- Deterministic mock data ------------------------------------------------

export const STUB_USER_ID = "user_settings_stub";
export const STUB_SETTINGS_API_KEY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const STUB_FG_CONNECTION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const STUB_SESSION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const STUB_CREATED_AT = DateTime.makeUnsafe("2026-04-22T00:00:00.000Z");

const STUB_PREFERENCES: UserPreferencesWire = {
  userId: STUB_USER_ID,
  theme: "dark",
  defaultModel: "claude-opus-4-6",
  editorFontSize: 14,
  enableNotifications: true,
  timezone: "America/New_York",
  createdAt: STUB_CREATED_AT,
  updatedAt: STUB_CREATED_AT,
};

// --- Handlers ---------------------------------------------------------------

export const stubSettingsHandlers = {
  // --- General (13) ---

  "settings.getPreferences": () => Effect.succeed(STUB_PREFERENCES),

  "settings.updatePreferences": (input: {
    readonly theme?: "light" | "dark" | "system";
    readonly defaultModel?: string | null;
    readonly editorFontSize?: number | null;
    readonly enableNotifications?: boolean;
    readonly timezone?: string | null;
  }) =>
    Effect.succeed({
      ...STUB_PREFERENCES,
      ...input,
      updatedAt: STUB_CREATED_AT,
    } as UserPreferencesWire),

  "settings.listApiKeys": () =>
    Effect.succeed([
      {
        id: STUB_SETTINGS_API_KEY_ID,
        name: "Stub settings key",
        keyPrefix: "gmk_stub_set",
        permissions: ["read", "write"] as const,
        lastUsedAt: null,
        expiresAt: null,
        createdAt: STUB_CREATED_AT,
      },
    ]),

  "settings.createApiKey": (input: {
    readonly name: string;
    readonly permissions: readonly string[];
  }) =>
    Effect.succeed({
      id: STUB_SETTINGS_API_KEY_ID,
      name: input.name,
      keyPrefix: "gmk_stub_new",
      permissions: input.permissions as readonly ("read" | "write" | "delete" | "admin")[],
      expiresAt: null,
      key: "gmk_stub_plaintext_settings_key",
    }),

  "settings.revokeApiKey": (_input: { readonly id: string }) =>
    Effect.succeed({ success: true }),

  "settings.listConfigRoots": () =>
    Effect.succeed([
      { id: "claude_dot" as const, label: "Claude (.claude)", dir: "/home/stub/.claude", exists: true },
      { id: "opencode_xdg" as const, label: "OpenCode (XDG config)", dir: "/home/stub/.config/opencode", exists: false },
      { id: "opencode_dot" as const, label: "OpenCode (.opencode)", dir: "/home/stub/.opencode", exists: false },
      { id: "codex_dot" as const, label: "Codex (.codex)", dir: "/home/stub/.codex", exists: false },
      { id: "gemini_dot" as const, label: "Gemini (.gemini)", dir: "/home/stub/.gemini", exists: false },
      { id: "kiro_dot" as const, label: "Kiro (.kiro)", dir: "/home/stub/.kiro", exists: false },
      { id: "cursor_agent_dot" as const, label: "Cursor Agent (.cursor-agent)", dir: "/home/stub/.cursor-agent", exists: false },
    ]),

  "settings.listConfigEntries": (input: {
    readonly rootId: string;
    readonly dir?: string;
  }) =>
    Effect.succeed({
      rootDir: `/home/stub/.${input.rootId}`,
      dir: input.dir ?? "",
      entries: [
        { name: "CLAUDE.md", path: "CLAUDE.md", isDir: false, size: 1024, mtimeMs: 1713744000000 },
        { name: "settings", path: "settings", isDir: true, size: null, mtimeMs: 1713744000000 },
      ],
    }),

  "settings.readConfigFile": (input: {
    readonly rootId: string;
    readonly path: string;
  }) =>
    Effect.succeed({
      rootDir: `/home/stub/.${input.rootId}`,
      path: input.path,
      size: 42,
      mtimeMs: 1713744000000,
      content: "# stub config file content",
    }),

  "settings.writeConfigFile": (input: {
    readonly rootId: string;
    readonly path: string;
    readonly content: string;
  }) =>
    Effect.succeed({
      rootDir: `/home/stub/.${input.rootId}`,
      path: input.path,
      size: input.content.length,
      mtimeMs: 1713744000000,
    }),

  "settings.deleteConfigFile": (_input: {
    readonly rootId: string;
    readonly path: string;
  }) => Effect.succeed({ success: true }),

  "settings.getForgeGraphConnection": () =>
    Effect.succeed({
      id: STUB_FG_CONNECTION_ID,
      providerUsername: "forgegraph",
      createdAt: STUB_CREATED_AT,
    }),

  "settings.connectForgeGraph": (_input: { readonly apiToken: string }) =>
    Effect.succeed({
      id: STUB_FG_CONNECTION_ID,
      providerUsername: "forgegraph",
      createdAt: STUB_CREATED_AT,
    }),

  "settings.disconnectForgeGraph": () =>
    Effect.succeed({ success: true }),

  // --- Cookies (5) ---

  "settings.cookies.import": (input: {
    readonly cookies: readonly unknown[];
  }) =>
    Effect.succeed({
      imported: input.cookies.length,
      domains: ["example.com"],
    }),

  "settings.cookies.list": () =>
    Effect.succeed([
      {
        domain: "example.com",
        count: 3,
        source: "extension",
        lastUpdated: STUB_CREATED_AT,
      },
    ]),

  "settings.cookies.remove": (_input: { readonly domain: string }) =>
    Effect.succeed({ deleted: 3 }),

  "settings.cookies.getForSession": (_input: {
    readonly sessionId: string;
    readonly domain: string;
  }) =>
    Effect.succeed({
      cookies: [
        {
          name: "session_id",
          value: "stub_cookie_value",
          domain: "example.com",
          path: "/",
          expires: -1,
          secure: true,
          httpOnly: true,
          sameSite: "Lax" as const,
        },
      ],
    }),

  "settings.cookies.setSessionScopes": (input: {
    readonly sessionId: string;
    readonly domains: readonly string[];
  }) => Effect.succeed({ scoped: input.domains.length }),

  // --- System (2) ---

  "settings.system.health": () =>
    Effect.succeed({
      status: "ok" as const,
      timestamp: "2026-04-22T00:00:00.000Z",
    }),

  "settings.system.status": () =>
    Effect.succeed({
      agents: [],
      github: {
        status: "unknown" as const,
        version: "",
        user: "",
      },
      metrics: {
        repositories: 5,
        worktrees: 2,
        totalInstances: 3,
        activeInstances: 1,
      },
      server: {
        uptime: 86400,
        memory: {
          rss: 100_000_000,
          heapTotal: 50_000_000,
          heapUsed: 30_000_000,
          external: 5_000_000,
        },
        nodeVersion: "v22.0.0",
      },
    }),
};

// --- Layer form for RpcServer mounting ---

export const stubSettingsHandlersLayer = SettingsRpc.toLayer(stubSettingsHandlers);

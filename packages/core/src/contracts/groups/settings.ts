// Settings RPC contract group — preferences, API keys, config browsing,
// ForgeGraph, cookies, and system health.
//
// Design notes:
//   - Three sub-namespaces: `settings.*` (general), `settings.cookies.*`,
//     `settings.system.*`. All belong to a single SettingsRpc group so a
//     consumer can mount one handler layer to serve all 20 procedures.
//   - `settings.system.health` is the only public procedure (no auth).
//     All others assume `CurrentUser` is present via `AuthMiddleware`.
//   - Config root browsing (`listConfigRoots`, `listConfigEntries`,
//     `readConfigFile`, `writeConfigFile`, `deleteConfigFile`) mirrors
//     Bob's settings router for agent-config-tool roots.
//   - Cookie import uses a separate `cookies` input array schema
//     mirroring the Bob extension/CLI import flow.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  UserPreferencesSchema,
  SettingsApiKeySchema,
  ConfigRootSchema,
  ConfigRootIdEnum,
  ConfigEntrySchema,
  ConfigFileSchema,
  ForgeGraphConnectionSchema,
} from "../schemas/settings-general.js";

import {
  CookieInputSchema,
  CookieDomainSchema,
  CookieSchema,
} from "../schemas/settings-cookies.js";

import {
  SystemHealthSchema,
  SystemStatusSchema,
} from "../schemas/settings-system.js";

// --- General settings --------------------------------------------------------

export const SettingsGetPreferencesRpc = Rpc.make("settings.getPreferences", {
  payload: Schema.Void,
  success: UserPreferencesSchema,
});

export const SettingsUpdatePreferencesRpc = Rpc.make("settings.updatePreferences", {
  payload: Schema.Struct({
    theme: Schema.optional(Schema.Literals(["light", "dark", "system"])),
    defaultModel: Schema.optional(Schema.NullOr(Schema.String)),
    editorFontSize: Schema.optional(Schema.NullOr(Schema.Number)),
    enableNotifications: Schema.optional(Schema.Boolean),
    emailNotifications: Schema.optional(Schema.Boolean),
    pushNotifications: Schema.optional(Schema.Boolean),
    timezone: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: UserPreferencesSchema,
});

export const SettingsListApiKeysRpc = Rpc.make("settings.listApiKeys", {
  payload: Schema.Void,
  success: Schema.Array(SettingsApiKeySchema),
});

export const SettingsCreateApiKeyRpc = Rpc.make("settings.createApiKey", {
  payload: Schema.Struct({
    name: Schema.String,
    permissions: Schema.Array(Schema.Literals(["read", "write", "delete", "admin"])),
    expiresInDays: Schema.optional(Schema.Number),
  }),
  success: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    keyPrefix: Schema.String,
    permissions: Schema.Array(Schema.Literals(["read", "write", "delete", "admin"])),
    expiresAt: Schema.NullOr(Schema.DateTimeUtc),
    key: Schema.String, // plaintext — returned exactly once at creation
  }),
});

export const SettingsRevokeApiKeyRpc = Rpc.make("settings.revokeApiKey", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

export const SettingsListConfigRootsRpc = Rpc.make("settings.listConfigRoots", {
  payload: Schema.Void,
  success: Schema.Array(ConfigRootSchema),
});

export const SettingsListConfigEntriesRpc = Rpc.make("settings.listConfigEntries", {
  payload: Schema.Struct({
    rootId: ConfigRootIdEnum,
    dir: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    rootDir: Schema.String,
    dir: Schema.String,
    entries: Schema.Array(ConfigEntrySchema),
  }),
});

export const SettingsReadConfigFileRpc = Rpc.make("settings.readConfigFile", {
  payload: Schema.Struct({
    rootId: ConfigRootIdEnum,
    path: Schema.String,
  }),
  success: ConfigFileSchema,
});

export const SettingsWriteConfigFileRpc = Rpc.make("settings.writeConfigFile", {
  payload: Schema.Struct({
    rootId: ConfigRootIdEnum,
    path: Schema.String,
    content: Schema.String,
    createOnly: Schema.optional(Schema.Boolean),
  }),
  success: ConfigFileSchema,
});

export const SettingsDeleteConfigFileRpc = Rpc.make("settings.deleteConfigFile", {
  payload: Schema.Struct({
    rootId: ConfigRootIdEnum,
    path: Schema.String,
  }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

export const SettingsGetForgeGraphConnectionRpc = Rpc.make("settings.getForgeGraphConnection", {
  payload: Schema.Void,
  success: Schema.NullOr(ForgeGraphConnectionSchema),
});

export const SettingsConnectForgeGraphRpc = Rpc.make("settings.connectForgeGraph", {
  payload: Schema.Struct({
    apiToken: Schema.String,
  }),
  success: ForgeGraphConnectionSchema,
});

export const SettingsDisconnectForgeGraphRpc = Rpc.make("settings.disconnectForgeGraph", {
  payload: Schema.Void,
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- Cookies -----------------------------------------------------------------

export const SettingsCookiesImportRpc = Rpc.make("settings.cookies.import", {
  payload: Schema.Struct({
    cookies: Schema.Array(CookieInputSchema),
    source: Schema.optional(Schema.Literals(["extension", "cli"])),
  }),
  success: Schema.Struct({
    imported: Schema.Number,
    domains: Schema.Array(Schema.String),
  }),
});

export const SettingsCookiesListRpc = Rpc.make("settings.cookies.list", {
  payload: Schema.Void,
  success: Schema.Array(CookieDomainSchema),
});

export const SettingsCookiesRemoveRpc = Rpc.make("settings.cookies.remove", {
  payload: Schema.Struct({ domain: Schema.String }),
  success: Schema.Struct({ deleted: Schema.Number }),
});

export const SettingsCookiesGetForSessionRpc = Rpc.make("settings.cookies.getForSession", {
  payload: Schema.Struct({
    sessionId: Schema.String,
    domain: Schema.String,
  }),
  success: Schema.Struct({
    cookies: Schema.Array(CookieSchema),
    error: Schema.optional(Schema.String),
  }),
});

export const SettingsCookiesSetSessionScopesRpc = Rpc.make("settings.cookies.setSessionScopes", {
  payload: Schema.Struct({
    sessionId: Schema.String,
    domains: Schema.Array(Schema.String),
  }),
  success: Schema.Struct({ scoped: Schema.Number }),
});

// --- System ------------------------------------------------------------------

export const SettingsSystemHealthRpc = Rpc.make("settings.system.health", {
  payload: Schema.Void,
  success: SystemHealthSchema,
});

export const SettingsSystemStatusRpc = Rpc.make("settings.system.status", {
  payload: Schema.Void,
  success: SystemStatusSchema,
});

// --- Group -------------------------------------------------------------------

export const SettingsRpc = RpcGroup.make(
  // General (13)
  SettingsGetPreferencesRpc,
  SettingsUpdatePreferencesRpc,
  SettingsListApiKeysRpc,
  SettingsCreateApiKeyRpc,
  SettingsRevokeApiKeyRpc,
  SettingsListConfigRootsRpc,
  SettingsListConfigEntriesRpc,
  SettingsReadConfigFileRpc,
  SettingsWriteConfigFileRpc,
  SettingsDeleteConfigFileRpc,
  SettingsGetForgeGraphConnectionRpc,
  SettingsConnectForgeGraphRpc,
  SettingsDisconnectForgeGraphRpc,
  // Cookies (5)
  SettingsCookiesImportRpc,
  SettingsCookiesListRpc,
  SettingsCookiesRemoveRpc,
  SettingsCookiesGetForSessionRpc,
  SettingsCookiesSetSessionScopesRpc,
  // System (2)
  SettingsSystemHealthRpc,
  SettingsSystemStatusRpc,
);

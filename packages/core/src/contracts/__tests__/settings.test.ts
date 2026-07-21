// Tests for the Settings RPC contract group + stub handlers.
//
// Validates:
//   1. All 20 procedures are wired into the group by tag.
//   2. Stub handlers return deterministic mock data that round-trips
//      through the declared success schemas.
//   3. Sub-namespace coverage: general (13), cookies (5), system (2).
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import {
  SettingsRpc,
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
  SettingsCookiesImportRpc,
  SettingsCookiesListRpc,
  SettingsCookiesRemoveRpc,
  SettingsCookiesGetForSessionRpc,
  SettingsCookiesSetSessionScopesRpc,
  SettingsSystemHealthRpc,
  SettingsSystemStatusRpc,
} from "../groups/settings.js";
import {
  stubSettingsHandlersLayer,
  STUB_USER_ID,
  STUB_SETTINGS_API_KEY_ID,
  STUB_FG_CONNECTION_ID,
} from "../stubs/settings.js";
import { UserPreferencesSchema, ConfigRootSchema, ConfigEntrySchema } from "../schemas/settings-general.js";
import { CookieDomainSchema, CookieSchema } from "../schemas/settings-cookies.js";
import { SystemHealthSchema, SystemStatusSchema } from "../schemas/settings-system.js";

const EXPECTED_TAGS = [
  // General (13)
  "settings.getPreferences",
  "settings.updatePreferences",
  "settings.listApiKeys",
  "settings.createApiKey",
  "settings.revokeApiKey",
  "settings.listConfigRoots",
  "settings.listConfigEntries",
  "settings.readConfigFile",
  "settings.writeConfigFile",
  "settings.deleteConfigFile",
  "settings.getForgeGraphConnection",
  "settings.connectForgeGraph",
  "settings.disconnectForgeGraph",
  // Cookies (5)
  "settings.cookies.import",
  "settings.cookies.list",
  "settings.cookies.remove",
  "settings.cookies.getForSession",
  "settings.cookies.setSessionScopes",
  // System (2)
  "settings.system.health",
  "settings.system.status",
] as const;

describe("@gmacko/contracts SettingsRpc group", () => {
  it("declares all 20 expected procedure tags", () => {
    const tags = Array.from(SettingsRpc.requests.keys()).sort();
    expect(tags).toEqual([...EXPECTED_TAGS].sort());
    expect(SettingsRpc.requests.size).toBe(20);
  });

  it("exports individual Rpc descriptors with correct _tag values", () => {
    expect(SettingsGetPreferencesRpc._tag).toBe("settings.getPreferences");
    expect(SettingsUpdatePreferencesRpc._tag).toBe("settings.updatePreferences");
    expect(SettingsListApiKeysRpc._tag).toBe("settings.listApiKeys");
    expect(SettingsCreateApiKeyRpc._tag).toBe("settings.createApiKey");
    expect(SettingsRevokeApiKeyRpc._tag).toBe("settings.revokeApiKey");
    expect(SettingsListConfigRootsRpc._tag).toBe("settings.listConfigRoots");
    expect(SettingsListConfigEntriesRpc._tag).toBe("settings.listConfigEntries");
    expect(SettingsReadConfigFileRpc._tag).toBe("settings.readConfigFile");
    expect(SettingsWriteConfigFileRpc._tag).toBe("settings.writeConfigFile");
    expect(SettingsDeleteConfigFileRpc._tag).toBe("settings.deleteConfigFile");
    expect(SettingsGetForgeGraphConnectionRpc._tag).toBe("settings.getForgeGraphConnection");
    expect(SettingsConnectForgeGraphRpc._tag).toBe("settings.connectForgeGraph");
    expect(SettingsDisconnectForgeGraphRpc._tag).toBe("settings.disconnectForgeGraph");
    expect(SettingsCookiesImportRpc._tag).toBe("settings.cookies.import");
    expect(SettingsCookiesListRpc._tag).toBe("settings.cookies.list");
    expect(SettingsCookiesRemoveRpc._tag).toBe("settings.cookies.remove");
    expect(SettingsCookiesGetForSessionRpc._tag).toBe("settings.cookies.getForSession");
    expect(SettingsCookiesSetSessionScopesRpc._tag).toBe("settings.cookies.setSessionScopes");
    expect(SettingsSystemHealthRpc._tag).toBe("settings.system.health");
    expect(SettingsSystemStatusRpc._tag).toBe("settings.system.status");
  });

  it("stub handlers return deterministic mock data for general settings", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SettingsRpc);

      // Preferences
      const prefs = yield* client["settings.getPreferences"]();
      Schema.decodeUnknownSync(UserPreferencesSchema)(prefs);
      expect(prefs.userId).toBe(STUB_USER_ID);
      expect(prefs.theme).toBe("dark");
      expect(prefs.emailNotifications).toBe(true);
      expect(prefs.pushNotifications).toBe(true);

      // Update preferences
      const updated = yield* client["settings.updatePreferences"]({
        theme: "light",
        emailNotifications: false,
        pushNotifications: false,
      });
      Schema.decodeUnknownSync(UserPreferencesSchema)(updated);
      expect(updated.theme).toBe("light");
      expect(updated.emailNotifications).toBe(false);
      expect(updated.pushNotifications).toBe(false);

      // API keys
      const keys = yield* client["settings.listApiKeys"]();
      expect(keys).toHaveLength(1);
      expect(keys[0]!.id).toBe(STUB_SETTINGS_API_KEY_ID);

      // Create API key
      const newKey = yield* client["settings.createApiKey"]({
        name: "test key",
        permissions: ["read"],
      });
      expect(newKey.key).toBe("gmk_stub_plaintext_settings_key");

      // Revoke API key
      const revoked = yield* client["settings.revokeApiKey"]({ id: STUB_SETTINGS_API_KEY_ID });
      expect(revoked.success).toBe(true);

      // Config roots
      const roots = yield* client["settings.listConfigRoots"]();
      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) {
        Schema.decodeUnknownSync(ConfigRootSchema)(root);
      }

      // Config entries
      const entries = yield* client["settings.listConfigEntries"]({
        rootId: "claude_dot",
      });
      expect(entries.entries.length).toBeGreaterThan(0);
      for (const entry of entries.entries) {
        Schema.decodeUnknownSync(ConfigEntrySchema)(entry);
      }

      // Read config file
      const file = yield* client["settings.readConfigFile"]({
        rootId: "claude_dot",
        path: "CLAUDE.md",
      });
      expect(file.content).toBe("# stub config file content");

      // Write config file
      const written = yield* client["settings.writeConfigFile"]({
        rootId: "claude_dot",
        path: "test.md",
        content: "hello",
      });
      expect(written.size).toBe(5);

      // Delete config file
      const deleted = yield* client["settings.deleteConfigFile"]({
        rootId: "claude_dot",
        path: "test.md",
      });
      expect(deleted.success).toBe(true);

      // ForgeGraph connection
      const conn = yield* client["settings.getForgeGraphConnection"]();
      expect(conn!.id).toBe(STUB_FG_CONNECTION_ID);

      // Connect ForgeGraph
      const connected = yield* client["settings.connectForgeGraph"]({ apiToken: "test" });
      expect(connected.id).toBe(STUB_FG_CONNECTION_ID);

      // Disconnect ForgeGraph
      const disconnected = yield* client["settings.disconnectForgeGraph"]();
      expect(disconnected.success).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubSettingsHandlersLayer), Effect.scoped),
    );
  });

  it("stub handlers return deterministic mock data for cookies", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SettingsRpc);

      // Import cookies
      const imported = yield* client["settings.cookies.import"]({
        cookies: [
          { name: "test", value: "val", domain: "example.com", path: "/" },
        ],
      });
      expect(imported.imported).toBe(1);
      expect(imported.domains).toEqual(["example.com"]);

      // List cookie domains
      const domains = yield* client["settings.cookies.list"]();
      expect(domains).toHaveLength(1);
      Schema.decodeUnknownSync(CookieDomainSchema)(domains[0]);

      // Remove cookies
      const removed = yield* client["settings.cookies.remove"]({ domain: "example.com" });
      expect(removed.deleted).toBe(3);

      // Get cookies for session
      const session = yield* client["settings.cookies.getForSession"]({
        sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        domain: "example.com",
      });
      expect(session.cookies).toHaveLength(1);
      Schema.decodeUnknownSync(CookieSchema)(session.cookies[0]);

      // Set session scopes
      const scoped = yield* client["settings.cookies.setSessionScopes"]({
        sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        domains: ["example.com", "test.com"],
      });
      expect(scoped.scoped).toBe(2);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubSettingsHandlersLayer), Effect.scoped),
    );
  });

  it("stub handlers return deterministic mock data for system", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SettingsRpc);

      // Health
      const health = yield* client["settings.system.health"]();
      Schema.decodeUnknownSync(SystemHealthSchema)(health);
      expect(health.status).toBe("ok");

      // Status
      const status = yield* client["settings.system.status"]();
      Schema.decodeUnknownSync(SystemStatusSchema)(status);
      expect(status.metrics.repositories).toBe(5);
      expect(status.server.nodeVersion).toBe("v22.0.0");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubSettingsHandlersLayer), Effect.scoped),
    );
  });
});

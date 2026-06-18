// Client factory smoke tests.
//
// These factories wrap better-auth's client + expo client plugin. The factories
// produce network-calling clients, so we don't invoke any methods — we just
// assert the factories don't throw and hand back an object that looks like the
// documented client.
//
// Better-auth's `createAuthClient` returns a *dynamic path proxy* — virtually
// any property access returns either a real function/atom (for things like
// `useSession`, `$fetch`, `$store`) or another proxy-wrapped function (for
// RPC-style method lookups). That means shape assertions must be coarse:
// "is defined + doesn't throw" rather than "equals object".
//
// `@better-auth/expo/client` imports `expo-linking`, `expo-constants`, and
// `react-native` at module init — none of which load cleanly in Node. Rather
// than stubbing the entire Expo runtime, we mock the plugin itself: we replace
// `@better-auth/expo/client` with a stub that returns the minimal plugin
// shape better-auth expects. That verifies our factory's own glue code
// (argument pass-through + plugin composition) without coupling to Expo at
// test time. The real plugin is exercised in the Expo app's integration tests.
import { describe, expect, it, vi } from "vitest";

// Captured calls to the mocked expoClient so we can assert argument pass-through.
const expoClientCalls: Array<Record<string, unknown>> = [];

vi.mock("@better-auth/expo/client", () => ({
  expoClient: (opts: Record<string, unknown>) => {
    expoClientCalls.push(opts);
    return {
      id: "expo",
      getActions: () => ({ getCookie: () => "" }),
      fetchPlugins: [],
    };
  },
}));

import {
  createGmackoAuthClient,
  createGmackoExpoAuthClient,
} from "../client.js";

// Minimal in-memory storage that matches the expoClient storage contract.
const makeMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => store.set(k, v),
    getItem: (k: string) => store.get(k) ?? null,
  };
};

describe("@gmacko/auth createGmackoAuthClient (react)", () => {
  it("returns a client without throwing on valid input", () => {
    const client = createGmackoAuthClient({ baseURL: "http://localhost:3000" });
    expect(client).toBeDefined();
  });

  it("exposes useSession and the $fetch / $store proxy surface", () => {
    const client = createGmackoAuthClient({
      baseURL: "https://auth.example.com",
    });
    // Because better-auth returns a dynamic path proxy (target = function),
    // `typeof` on any property is "function". Assert presence instead of type.
    expect(client.useSession).toBeDefined();
    expect(client.$fetch).toBeDefined();
    expect(client.$store).toBeDefined();
  });
});

describe("@gmacko/auth createGmackoExpoAuthClient", () => {
  it("returns a client and forwards baseURL + storage to expoClient", async () => {
    const storage = makeMemoryStorage();
    const lenBefore = expoClientCalls.length;

    const client = await createGmackoExpoAuthClient({
      baseURL: "http://localhost:3000",
      storage,
    });

    expect(client).toBeDefined();
    // getCookie is contributed by the expoClient plugin via getActions.
    expect(client.getCookie).toBeDefined();
    expect(expoClientCalls.length).toBe(lenBefore + 1);
    const passed = expoClientCalls[lenBefore]!;
    expect(passed.storage).toBe(storage);
    expect(passed.storagePrefix).toBeUndefined();
  });

  it("forwards storagePrefix + scheme + disableCache to expoClient", async () => {
    const lenBefore = expoClientCalls.length;

    await createGmackoExpoAuthClient({
      baseURL: "http://localhost:3000",
      storage: makeMemoryStorage(),
      storagePrefix: "gmacko",
      scheme: "gmacko",
      disableCache: true,
    });

    const passed = expoClientCalls[lenBefore]!;
    expect(passed.storagePrefix).toBe("gmacko");
    expect(passed.scheme).toBe("gmacko");
    expect(passed.disableCache).toBe(true);
  });
});

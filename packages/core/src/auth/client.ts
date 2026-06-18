// Client factories for better-auth — one import, zero boilerplate for apps.
//
// Two factories ship here:
//   - createGmackoAuthClient (web/React) — wraps `better-auth/react`. Includes
//     apiKey + deviceAuthorization client plugins so the inferred action
//     surface mirrors the server configured in `better-auth.ts`.
//   - createGmackoExpoAuthClient (mobile) — wraps vanilla `better-auth/client`
//     + `@better-auth/expo/client`'s `expoClient()` plugin. The caller passes
//     the storage adapter (SecureStore in apps/mobile, memory in tests); we
//     don't hard-depend on `expo-secure-store` to keep this package importable
//     from the web bundle.
//
// Why not import from `effect` here? These factories run in browser + Expo
// runtimes where we deliberately keep Effect out of the client bundle. They're
// plain functions returning plain objects.
//
// Why is `react` not in `dependencies`? `better-auth/react` pulls in React at
// module-load time — apps that import this factory already have React. We
// declare it as an **optional peer dependency** so the web bundle isn't forced
// on Expo-only consumers (and vice versa for `@better-auth/expo`).
//
// IMPORTANT: we do NOT statically import `@better-auth/expo/client` — that
// module loads `expo-linking` / `expo-constants` / `react-native` at module
// init, which explodes in any non-Expo runtime (Node tests, SSR, etc.). We
// lazy-load it inside `createGmackoExpoAuthClient` so the web factory can be
// imported (and tested) without an Expo runtime.
//
// NOTE: not exported from the package barrel yet — Task 17 owns src/index.ts.
import { createAuthClient as createVanillaClient } from "better-auth/client";
import {
  apiKeyClient,
  deviceAuthorizationClient,
} from "better-auth/client/plugins";
import { createAuthClient as createReactClient } from "better-auth/react";

export interface CreateGmackoAuthClientOptions {
  /** Base URL of the server hosting better-auth (e.g. `https://app.gmacko.dev`). */
  readonly baseURL: string;
}

/**
 * React client for web apps. Hooks (`useSession`, plus plugin-inferred hooks)
 * are real React hooks — must be called inside components.
 */
export function createGmackoAuthClient(opts: CreateGmackoAuthClientOptions) {
  return createReactClient({
    baseURL: opts.baseURL,
    plugins: [apiKeyClient(), deviceAuthorizationClient()],
  });
}

/** Storage adapter shape required by `@better-auth/expo/client`. */
export interface ExpoAuthStorage {
  readonly setItem: (key: string, value: string) => unknown;
  readonly getItem: (key: string) => string | null;
}

export interface CreateGmackoExpoAuthClientOptions {
  readonly baseURL: string;
  /**
   * Expo SecureStore-compatible storage. Apps pass
   * `{ setItem: SecureStore.setItemAsync, getItem: SecureStore.getItem }`.
   */
  readonly storage: ExpoAuthStorage;
  /** Prefix applied to all keys written into `storage`. */
  readonly storagePrefix?: string;
  /** Deep-link scheme for cookie-bearing redirects (e.g. "gmacko"). */
  readonly scheme?: string;
  /** Disable the in-memory session cache. */
  readonly disableCache?: boolean;
}

/**
 * Vanilla (non-React) client + expo plugin for Expo apps. `useSession` is a
 * nanostores atom here — apps subscribe via `@nanostores/react` (or equivalent)
 * rather than a hook call.
 *
 * Async because `@better-auth/expo/client` touches expo-linking/react-native at
 * module init; we lazy-load it to keep the web factory side of this module
 * importable in non-Expo runtimes. Callers should `await` this once during app
 * bootstrap and stash the result.
 */
export async function createGmackoExpoAuthClient(
  opts: CreateGmackoExpoAuthClientOptions,
) {
  const { expoClient } = await import("@better-auth/expo/client");
  return createVanillaClient({
    baseURL: opts.baseURL,
    plugins: [
      expoClient({
        storage: opts.storage,
        storagePrefix: opts.storagePrefix,
        scheme: opts.scheme,
        disableCache: opts.disableCache,
      }),
      apiKeyClient(),
      deviceAuthorizationClient(),
    ],
  });
}

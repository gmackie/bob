// Mobile auth is device-key based: the app obtains a Bob API key (prefix
// `bob_`/`gmk_`) through the pairing flow (QR scan or device-authorization
// grant — see app/pairing) and stores it in the OS keychain. That single key
// authenticates every surface:
//   - tRPC/RPC:  Authorization: Bearer <key>  → resolveAuthContext/validateApiKey
//   - gateway WS: passed as the connection `token`  → validateBrowserToken
// There is no OAuth / Better Auth session on mobile anymore.
//
// This module is a tiny reactive store over that key. `useSession()` keeps the
// shape the app already consumed from Better Auth (`{ data: { user }, isPending }`)
// so screens/gates need no change beyond importing from here.
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import {
  createDevAuthSession,
  getDevAuthBypassCookie,
  isDevAuthBypassEnabled,
} from "./dev-auth-bypass";

const API_KEY_STORE_KEY = "bob_device_api_key";

// The dev-auth bypass session is static; compute it once so its object
// identity is stable across `useSyncExternalStore` reads (a fresh object each
// read would loop React forever).
const DEV_SESSION = createDevAuthSession();

function readStoredKey(): string | null {
  try {
    return SecureStore.getItem(API_KEY_STORE_KEY);
  } catch {
    return null;
  }
}

let currentKey: string | null = readStoredKey();

const listeners = new Set<() => void>();
function emitChange(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The credential to present to the server. In dev-bypass mode this is the
 * `bob-auth-bypass:` token (the server accepts it from an Authorization Bearer
 * header or the gateway `token`, exactly as the old cookie path did); otherwise
 * it's the stored device API key, or null when signed out.
 */
export function getApiKey(): string | null {
  if (isDevAuthBypassEnabled()) return getDevAuthBypassCookie();
  return currentKey;
}

/** Persist a freshly-paired API key and notify session subscribers. */
export function signInWithApiKey(key: string): void {
  currentKey = key;
  try {
    SecureStore.setItem(API_KEY_STORE_KEY, key);
  } catch {
    // Keychain write can fail on some simulators; the in-memory value still
    // drives this launch, the user just re-pairs next cold start.
  }
  emitChange();
}

/** Forget the stored key and drop back to the pairing screen. */
export async function signOut(): Promise<void> {
  currentKey = null;
  try {
    await SecureStore.deleteItemAsync(API_KEY_STORE_KEY);
  } catch {
    // best-effort
  }
  emitChange();
}

// Session snapshot. `user.id` is a stable, non-secret identifier derived from
// the key — never the key itself. Downstream it is used only as a signed-in
// gate and a login/logout re-run trigger (push registration, gateway
// reconnect), so it doesn't need to be the real server user id.
interface MobileSession {
  readonly user: { readonly id: string };
}

// FNV-1a 32-bit — a tiny, dependency-free stable hash. Not cryptographic; it
// only needs to be deterministic per key and to change when the key changes.
function stableIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `device-${(hash >>> 0).toString(16)}`;
}

let cached: { key: string | null; session: MobileSession | null } = {
  key: null,
  session: null,
};

function getSessionSnapshot(): MobileSession | null {
  if (isDevAuthBypassEnabled()) {
    return DEV_SESSION;
  }
  const key = currentKey;
  if (key !== cached.key) {
    cached = {
      key,
      session: key ? { user: { id: stableIdFromKey(key) } } : null,
    };
  }
  return cached.session;
}

/**
 * Reactive session hook, shape-compatible with the Better Auth client the app
 * previously used: `{ data, isPending, error, isRefetching, refetch }`.
 * `isPending` is always false — the key is read synchronously from the keychain.
 */
export function useSession() {
  const data = useSyncExternalStore(
    subscribe,
    getSessionSnapshot,
    getSessionSnapshot,
  );
  return {
    data,
    isPending: false,
    error: null,
    isRefetching: false,
    refetch: () => {
      /* no-op: session changes flow through signInWithApiKey / signOut */
    },
  };
}

export const authClient = {
  useSession,
  signOut,
};

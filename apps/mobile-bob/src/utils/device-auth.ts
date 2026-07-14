// Pure helpers for the mobile pairing flow (QR scan + device-authorization
// grant). Kept side-effect-free so they can be unit-tested without a device.
//
// Bob API keys are prefixed `bob_` or `gmk_` (see packages/bob auth/api-key.ts
// `API_KEY_PREFIXES`). Both the gateway (`validateBrowserToken`) and the
// tRPC/RPC context (`resolveAuthContext` → `validateApiKey`) accept such a key
// as `Authorization: Bearer <key>`, so a paired mobile device authenticates
// everywhere with the one key it obtains here.

export const API_KEY_PREFIXES = ["bob_", "gmk_"] as const;

export function isApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    API_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
}

export interface QRPayload {
  readonly url: string;
  readonly token: string;
}

/**
 * Parse a scanned QR code. The Bob web "Pair mobile device" panel encodes
 * `JSON.stringify({ url, token })` where `token` is a freshly-minted
 * read+write API key. Returns null for anything that isn't a valid Bob token
 * QR so the scanner can keep looking.
 */
export function parseQR(data: string): QRPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const { url, token } = parsed as { url?: unknown; token?: unknown };
  if (typeof url !== "string" || url.length === 0) return null;
  if (!isApiKey(token)) return null;
  return { url, token };
}

/**
 * Extract the API key from a device-token poll response. Bob's
 * `GET /api/v1/device/token` returns `{ status: "complete", apiKey }` on
 * approval; tolerate `token` / `access_token` aliases for robustness against
 * server-shape drift. Returns null while pending / expired / denied.
 */
export function getDeviceFlowToken(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null;
  const body = payload as {
    apiKey?: unknown;
    token?: unknown;
    access_token?: unknown;
  };
  for (const candidate of [body.apiKey, body.token, body.access_token]) {
    if (isApiKey(candidate)) return candidate;
  }
  return null;
}

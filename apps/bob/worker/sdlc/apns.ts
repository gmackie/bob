// BOB-96: APNs `liveactivity` pushes, straight to Apple with token (JWT, ES256) auth.
// Bob's other pushes go through Expo, which does not carry Live Activity updates, so this
// needs its own APNs key: APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY (the .p8, a secret),
// APNS_BUNDLE_ID, and APNS_ENVIRONMENT ("production" for TestFlight/App Store, else "sandbox").
// Without them, nothing is sent and one line says so. Tokens are never logged.
import type { LiveActivitySend } from "./live-activity";

export interface ApnsEnv {
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_BUNDLE_ID?: string;
  APNS_ENVIRONMENT?: string;
}
export interface ApnsConfig { teamId: string; keyId: string; privateKey: string; bundleId: string; host: string }

export const APNS_HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" } as const;
/** Apple refuses provider tokens older than an hour and throttles refreshing more than every 20 minutes. */
export const JWT_REFRESH_MS = 50 * 60_000;
/** How long an ended activity stays on the lock screen. */
export const DISMISS_AFTER_S = 15 * 60;

export function apnsConfigFromEnv(env: ApnsEnv): ApnsConfig | null {
  const { APNS_TEAM_ID: teamId, APNS_KEY_ID: keyId, APNS_PRIVATE_KEY: privateKey, APNS_BUNDLE_ID: bundleId } = env;
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  const host = env.APNS_ENVIRONMENT === "sandbox" ? APNS_HOSTS.sandbox : APNS_HOSTS.production;
  return { teamId, keyId, privateKey, bundleId, host };
}

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** An ES256 provider token. WebCrypto's ECDSA signature is already the JWS r||s form. */
export async function providerToken(config: Pick<ApnsConfig, "teamId" | "keyId" | "privateKey">, nowMs: number): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(config.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signingInput = `${b64url(JSON.stringify({ alg: "ES256", kid: config.keyId }))}.${b64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) }))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

let cached: { keyId: string; token: string; at: number } | null = null;
async function cachedToken(config: ApnsConfig, nowMs: number): Promise<string> {
  if (cached && cached.keyId === config.keyId && nowMs - cached.at < JWT_REFRESH_MS) return cached.token;
  const token = await providerToken(config, nowMs);
  cached = { keyId: config.keyId, token, at: nowMs };
  return token;
}
/** Tests only. */
export const resetApnsTokenCache = () => { cached = null; };

/** The APNs body for one send: content-state is LiveActivityContent. */
export function liveActivityPayload(send: LiveActivitySend, nowMs: number): Record<string, unknown> {
  const timestamp = Math.floor(nowMs / 1000);
  return {
    aps: {
      timestamp,
      event: send.event,
      "content-state": send.content,
      ...(send.event === "end" ? { "dismissal-date": timestamp + DISMISS_AFTER_S } : {}),
      ...(send.alert ? { alert: send.alert, sound: "default" } : {}),
    },
  };
}

export interface ApnsResult { sent: number; failed: number; dead: string[] }
/** APNs reasons that mean the token will never work again. */
const DEAD_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

export async function sendLiveActivities(
  config: ApnsConfig,
  sends: readonly LiveActivitySend[],
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<ApnsResult> {
  const doFetch = deps.fetch ?? fetch;
  const now = (deps.now ?? Date.now)();
  const jwt = await cachedToken(config, now);
  const result: ApnsResult = { sent: 0, failed: 0, dead: [] };
  await Promise.all(sends.map(async (send) => {
    try {
      const response = await doFetch(`${config.host}/3/device/${send.token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-push-type": "liveactivity",
          "apns-topic": `${config.bundleId}.push-type.liveactivity`,
          "apns-priority": String(send.priority),
          "content-type": "application/json",
        },
        body: JSON.stringify(liveActivityPayload(send, now)),
      });
      if (response.ok) { result.sent++; return; }
      result.failed++;
      let reason = "";
      try { reason = ((await response.json()) as { reason?: string }).reason ?? ""; } catch { /* no body */ }
      if (response.status === 410 || DEAD_REASONS.has(reason)) result.dead.push(send.token);
      if (response.status === 403) cached = null; // a refused provider token is rebuilt next time
    } catch {
      result.failed++;
    }
  }));
  return result;
}

/**
 * What the DO hands sends to: APNs when configured, else one line saying nothing was sent.
 * Counts only, never tokens or content.
 */
export function liveActivitySender(
  env: ApnsEnv,
  forget: (tokens: string[]) => void,
  deps: { fetch?: typeof fetch; now?: () => number; log?: (line: string) => void } = {},
): (sends: LiveActivitySend[]) => Promise<void> {
  const log = deps.log ?? ((line: string) => console.log(line));
  return async (sends) => {
    const config = apnsConfigFromEnv(env);
    if (!config) { log(JSON.stringify({ event: "sdlc_live_activity_unconfigured", planned: sends.length })); return; }
    try {
      const { sent, failed, dead } = await sendLiveActivities(config, sends, deps);
      if (dead.length > 0) forget(dead);
      log(JSON.stringify({ event: "sdlc_live_activity_sent", planned: sends.length, sent, failed, dead: dead.length }));
    } catch (error) {
      log(JSON.stringify({ event: "sdlc_live_activity_failed", planned: sends.length, error: error instanceof Error ? error.message : String(error) }));
    }
  };
}

// The device login flow (RFC 8628 style) against Bob's /api/v1/device/* routes:
//   POST /api/v1/device/code {deviceName} → {deviceCode, userCode, verificationUrl, expiresIn, interval}
//   (the user opens verificationUrl, signed in, and approves; that mints a bob_ API key)
//   GET  /api/v1/device/token?device_code=… → {status: "pending" | "expired"} | {status: "complete", apiKey}
// The key is handed out once. Same shapes as bob-cli's cmd/login.go.

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class LoginError extends Error {}

export async function requestDeviceCode(fetchImpl: FetchLike, baseUrl: string, deviceName: string): Promise<DeviceCode> {
  const res = await fetchImpl(`${baseUrl}/api/v1/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceName }),
  });
  if (!res.ok) throw new LoginError(`Requesting a device code failed: HTTP ${res.status}`);
  const body = (await res.json()) as Partial<DeviceCode>;
  if (typeof body.deviceCode !== "string" || typeof body.userCode !== "string" || typeof body.verificationUrl !== "string") {
    throw new LoginError("The device code response was malformed.");
  }
  return {
    deviceCode: body.deviceCode,
    userCode: body.userCode,
    verificationUrl: body.verificationUrl,
    expiresIn: typeof body.expiresIn === "number" && body.expiresIn > 0 ? body.expiresIn : 900,
    interval: typeof body.interval === "number" && body.interval > 0 ? body.interval : 5,
  };
}

export interface PollOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls the token endpoint every `interval` seconds until the code is approved (returns
 * the key), expires, or the deadline passes. A 429 (the route is rate limited) or a 5xx
 * and network errors slow the poll down by 5 s and keep going, as RFC 8628's slow_down does; other errors stop.
 */
export async function pollForApiKey(fetchImpl: FetchLike, baseUrl: string, code: DeviceCode, options: PollOptions = {}): Promise<string> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + code.expiresIn * 1000;
  let interval = code.interval * 1000;
  for (;;) {
    if (options.signal?.aborted) throw new LoginError("Login cancelled.");
    if (now() >= deadline) throw new LoginError("The device code expired before it was approved. Run bob-tui login again.");
    await sleep(interval);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(`${baseUrl}/api/v1/device/token?device_code=${encodeURIComponent(code.deviceCode)}`);
    } catch {
      // A dropped connection or DNS blip: keep polling (slower) until the deadline.
      interval += 5_000;
      continue;
    }
    if (res.status === 429 || res.status >= 500) { interval += 5_000; continue; }
    if (res.status === 404) throw new LoginError("The server no longer knows this device code. Run bob-tui login again.");
    if (!res.ok) throw new LoginError(`Polling for approval failed: HTTP ${res.status}`);
    const body = (await res.json()) as { status?: unknown; apiKey?: unknown };
    if (body.status === "pending") continue;
    if (body.status === "expired") throw new LoginError("The device code expired before it was approved. Run bob-tui login again.");
    if (body.status === "complete" && typeof body.apiKey === "string" && body.apiKey.startsWith("bob_")) return body.apiKey;
    throw new LoginError(`Unexpected token response status: ${String(body.status)}`);
  }
}

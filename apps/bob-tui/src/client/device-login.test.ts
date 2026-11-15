import { describe, expect, it } from "vitest";

import { LoginError, pollForApiKey, requestDeviceCode, type DeviceCode, type FetchLike } from "./device-login";

type Reply = { status?: number; body?: unknown };

function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = replies.shift() ?? { status: 500 };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  return { fetchImpl, calls };
}

function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps };
}

const code: DeviceCode = { deviceCode: "dc-1", userCode: "ABCD-EFGH", verificationUrl: "https://bob.blder.bot/device/ABCD-EFGH", expiresIn: 60, interval: 5 };
const KEY = `bob_${"a".repeat(64)}`;

describe("requestDeviceCode", () => {
  it("POSTs the device name and returns the code", async () => {
    const f = fakeFetch([{ body: { ...code } }]);
    expect(await requestDeviceCode(f.fetchImpl, "https://bob.blder.bot", "Bob TUI (host)")).toEqual(code);
    expect(f.calls[0]).toEqual({ url: "https://bob.blder.bot/api/v1/device/code", init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceName: "Bob TUI (host)" }) } });
  });

  it("defaults interval and expiry, and rejects a malformed or failed response", async () => {
    const f = fakeFetch([{ body: { deviceCode: "d", userCode: "u", verificationUrl: "v" } }]);
    expect(await requestDeviceCode(f.fetchImpl, "x", "n")).toMatchObject({ interval: 5, expiresIn: 900 });
    await expect(requestDeviceCode(fakeFetch([{ body: {} }]).fetchImpl, "x", "n")).rejects.toThrow(/malformed/);
    await expect(requestDeviceCode(fakeFetch([{ status: 429 }]).fetchImpl, "x", "n")).rejects.toThrow(/HTTP 429/);
  });
});

describe("pollForApiKey", () => {
  it("polls every interval until complete and returns the key", async () => {
    const f = fakeFetch([{ body: { status: "pending" } }, { body: { status: "pending" } }, { body: { status: "complete", apiKey: KEY } }]);
    const c = clock();
    expect(await pollForApiKey(f.fetchImpl, "https://bob.blder.bot", code, c)).toBe(KEY);
    expect(c.sleeps).toEqual([5000, 5000, 5000]);
    expect(f.calls.map((x) => x.url)).toEqual(Array(3).fill("https://bob.blder.bot/api/v1/device/token?device_code=dc-1"));
  });

  it("slows down on 429 and 5xx", async () => {
    const f = fakeFetch([{ status: 429 }, { status: 503 }, { body: { status: "complete", apiKey: KEY } }]);
    const c = clock();
    await pollForApiKey(f.fetchImpl, "b", code, c);
    expect(c.sleeps).toEqual([5000, 10000, 15000]);
  });

  it("stops on expired, an unknown code, or the deadline", async () => {
    await expect(pollForApiKey(fakeFetch([{ body: { status: "expired" } }]).fetchImpl, "b", code, clock())).rejects.toThrow(/expired/);
    await expect(pollForApiKey(fakeFetch([{ status: 404 }]).fetchImpl, "b", code, clock())).rejects.toThrow(/no longer knows/);
    const pending = fakeFetch(Array.from({ length: 50 }, () => ({ body: { status: "pending" } })));
    const c = clock();
    await expect(pollForApiKey(pending.fetchImpl, "b", code, c)).rejects.toBeInstanceOf(LoginError);
    expect(pending.calls.length).toBe(12); // 60 s / 5 s
  });

  it("rejects a complete response without a bob_ key, and honours abort", async () => {
    await expect(pollForApiKey(fakeFetch([{ body: { status: "complete", apiKey: "nope" } }]).fetchImpl, "b", code, clock())).rejects.toThrow(/Unexpected/);
    const controller = new AbortController();
    controller.abort();
    await expect(pollForApiKey(fakeFetch([]).fetchImpl, "b", code, { ...clock(), signal: controller.signal })).rejects.toThrow(/cancelled/);
  });
});

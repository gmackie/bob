import { describe, expect, it } from "vitest";

import { parseQrPairingPayload } from "./qr-payload";

const ORIGIN = "https://bob.blder.bot";

describe("parseQrPairingPayload", () => {
  it("accepts a valid payload for the expected origin", () => {
    const data = JSON.stringify({
      v: 1,
      url: ORIGIN,
      code: "a".repeat(43),
    });
    expect(parseQrPairingPayload(data, ORIGIN)).toEqual({
      ok: true,
      code: "a".repeat(43),
    });
  });

  it("accepts an origin that differs only by trailing slash", () => {
    const data = JSON.stringify({
      v: 1,
      url: `${ORIGIN}/`,
      code: "b".repeat(43),
    });
    expect(parseQrPairingPayload(data, ORIGIN)).toMatchObject({ ok: true });
  });

  it("rejects a payload for a different server", () => {
    const data = JSON.stringify({
      v: 1,
      url: "https://evil.example.com",
      code: "c".repeat(43),
    });
    expect(parseQrPairingPayload(data, ORIGIN)).toMatchObject({
      ok: false,
      reason: "wrong-server",
    });
  });

  it("rejects non-JSON data", () => {
    expect(parseQrPairingPayload("https://random.url/qr", ORIGIN)).toMatchObject(
      { ok: false, reason: "invalid" },
    );
  });

  it("rejects a payload missing the code", () => {
    const data = JSON.stringify({ v: 1, url: ORIGIN });
    expect(parseQrPairingPayload(data, ORIGIN)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an unsupported version", () => {
    const data = JSON.stringify({ v: 2, url: ORIGIN, code: "d".repeat(43) });
    expect(parseQrPairingPayload(data, ORIGIN)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an implausibly short code", () => {
    const data = JSON.stringify({ v: 1, url: ORIGIN, code: "short" });
    expect(parseQrPairingPayload(data, ORIGIN)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });
});

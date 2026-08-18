// Parses the QR payload rendered by Bob web's "Link a Device" section.
// Payload shape: {"v":1,"url":"https://bob.blder.bot","code":"<one-time>"}.
//
// The `url` is checked against the app's own configured auth origin and the
// code is only ever sent there — scanning a QR from a foreign server fails
// closed instead of signing the user into (or leaking the claim to) an
// attacker-controlled host.

const MIN_CODE_LENGTH = 16;
const MAX_CODE_LENGTH = 128;

export type QrPayloadResult =
  | { ok: true; code: string }
  | { ok: false; reason: "invalid" | "wrong-server" };

function normalizeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function parseQrPairingPayload(
  data: string,
  expectedOrigin: string,
): QrPayloadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "invalid" };
  }
  const { v, url, code } = parsed as Record<string, unknown>;

  if (v !== 1) return { ok: false, reason: "invalid" };
  if (typeof url !== "string" || typeof code !== "string") {
    return { ok: false, reason: "invalid" };
  }
  if (code.length < MIN_CODE_LENGTH || code.length > MAX_CODE_LENGTH) {
    return { ok: false, reason: "invalid" };
  }

  const payloadOrigin = normalizeOrigin(url);
  const appOrigin = normalizeOrigin(expectedOrigin);
  if (!payloadOrigin || !appOrigin || payloadOrigin !== appOrigin) {
    return { ok: false, reason: "wrong-server" };
  }

  return { ok: true, code };
}

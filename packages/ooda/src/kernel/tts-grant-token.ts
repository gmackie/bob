const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createTtsGrantToken(
  grantId: string,
  secret: string,
): Promise<string> {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error("OODA TTS grant secret must be at least 32 bytes");
  }
  if (grantId.includes(".")) {
    throw new Error("TTS grant IDs cannot contain periods");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(grantId),
  );
  return `${grantId}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function hashTtsGrantToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToHex(new Uint8Array(digest));
}

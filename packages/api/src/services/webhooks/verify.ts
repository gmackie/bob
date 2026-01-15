import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expectedPrefix = "sha256=";
  if (!signature.startsWith(expectedPrefix)) return false;

  const signatureHex = signature.slice(expectedPrefix.length);
  const expectedSignature = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signatureHex, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
    return false;
  }
}

export function verifyGitLabToken(
  token: string | null,
  expectedToken: string,
): boolean {
  if (!token) return false;

  try {
    return timingSafeEqual(
      Buffer.from(token, "utf8"),
      Buffer.from(expectedToken, "utf8"),
    );
  } catch {
    return false;
  }
}

export function verifyGiteaSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expectedSignature = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
    return false;
  }
}

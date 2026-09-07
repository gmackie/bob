import { readInferenceKeys } from "./env";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function authorizeInferenceRequest(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): AuthResult {
  const keys = readInferenceKeys(env);
  const configuredKey = keys.bobApiKey;

  if (!configuredKey) {
    return {
      ok: false,
      status: 503,
      message: "Inference authentication is not configured",
    };
  }

  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      status: 401,
      message: "Missing Authorization: Bearer token",
    };
  }

  const token = header.slice(7).trim();
  if (!token || token !== configuredKey) {
    return { ok: false, status: 401, message: "Invalid API key" };
  }

  return { ok: true };
}

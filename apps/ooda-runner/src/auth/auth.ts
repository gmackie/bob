import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const TOKEN_FILENAME = ".runner-token";
const TOKEN_BYTES = 32;

export function generateRunnerToken(storageRoot: string): string {
  const tokenPath = join(storageRoot, TOKEN_FILENAME);

  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim();
  }

  mkdirSync(storageRoot, { recursive: true });

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  writeFileSync(tokenPath, token, { mode: 0o600 });

  return token;
}

export function loadRunnerToken(storageRoot: string): string | null {
  const tokenPath = join(storageRoot, TOKEN_FILENAME);

  if (!existsSync(tokenPath)) {
    return null;
  }

  return readFileSync(tokenPath, "utf-8").trim();
}

export function validateRunnerToken(
  storageRoot: string,
  candidateToken: string,
): boolean {
  const storedToken = loadRunnerToken(storageRoot);
  if (!storedToken) return false;

  // Constant-time comparison
  if (storedToken.length !== candidateToken.length) return false;

  let result = 0;
  for (let i = 0; i < storedToken.length; i++) {
    result |= storedToken.charCodeAt(i) ^ candidateToken.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Shared master-key helpers for Bob's token / cookie / session-secret vaults.
 *
 * Current key:  GIT_TOKEN_ENCRYPTION_KEY  (required, ≥ 32 chars)
 * Previous key: GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS (optional, for rotation window)
 *
 * Encryption always uses the current key. Decryption tries current first, then
 * previous so stored material can be re-encrypted during a rotation without
 * downtime.
 */

export const KEY_LENGTH = 32;

export const CURRENT_KEY_ENV = "GIT_TOKEN_ENCRYPTION_KEY" as const;
export const PREVIOUS_KEY_ENV = "GIT_TOKEN_ENCRYPTION_KEY_PREVIOUS" as const;

function parseMasterKey(raw: string | undefined, envName: string): Buffer {
  if (!raw) {
    throw new Error(`${envName} environment variable is required`);
  }
  if (raw.length < KEY_LENGTH) {
    throw new Error(
      `${envName} must be at least ${KEY_LENGTH} characters`,
    );
  }
  return Buffer.from(raw.slice(0, KEY_LENGTH), "utf8");
}

/** True when the current encryption key is present and long enough. */
export function isEncryptionConfigured(): boolean {
  const key = process.env[CURRENT_KEY_ENV];
  return !!key && key.length >= KEY_LENGTH;
}

/**
 * Fail closed: throw if the current encryption key is missing or too short.
 * Call at boot or before any vault write path that would otherwise soft-fail.
 */
export function requireEncryptionConfigured(): void {
  if (!isEncryptionConfigured()) {
    throw new Error(
      `${CURRENT_KEY_ENV} environment variable is required and must be at least ${KEY_LENGTH} characters`,
    );
  }
}

/** Current master key. Throws if missing/short. */
export function getCurrentMasterKey(): Buffer {
  return parseMasterKey(process.env[CURRENT_KEY_ENV], CURRENT_KEY_ENV);
}

/**
 * Previous master key used only during a rotation window.
 * Returns null when unset (normal steady-state).
 * Throws if set but too short — misconfiguration should not be silent.
 */
export function getPreviousMasterKey(): Buffer | null {
  const raw = process.env[PREVIOUS_KEY_ENV];
  if (!raw) return null;
  return parseMasterKey(raw, PREVIOUS_KEY_ENV);
}

/** Keys to try on decrypt, current first then previous (if any). */
export function getDecryptMasterKeys(): Buffer[] {
  const current = getCurrentMasterKey();
  const keys = [current];
  const previous = getPreviousMasterKey();
  if (previous && !previous.equals(current)) {
    keys.push(previous);
  }
  return keys;
}

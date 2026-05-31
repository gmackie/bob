const KEY_LENGTH = 32;

export function getEncryptionKeys(): Buffer[] {
  const configuredKeys =
    process.env.GIT_TOKEN_ENCRYPTION_KEYS ??
    process.env.GIT_TOKEN_ENCRYPTION_KEY;

  if (!configuredKeys) {
    throw new Error(
      "GIT_TOKEN_ENCRYPTION_KEY or GIT_TOKEN_ENCRYPTION_KEYS environment variable is required",
    );
  }

  const keys = configuredKeys
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error("At least one token vault encryption key is required");
  }

  for (const key of keys) {
    if (key.length < KEY_LENGTH) {
      throw new Error(
        `Token vault encryption keys must be at least ${KEY_LENGTH} characters`,
      );
    }
  }

  return keys.map((key) => Buffer.from(key.slice(0, KEY_LENGTH), "utf8"));
}

export function getPrimaryEncryptionKey(): Buffer {
  return getEncryptionKeys()[0]!;
}

export function isEncryptionKeyringConfigured(): boolean {
  const configuredKeys =
    process.env.GIT_TOKEN_ENCRYPTION_KEYS ??
    process.env.GIT_TOKEN_ENCRYPTION_KEY;
  const keys = configuredKeys
    ?.split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  return Boolean(
    keys && keys.length > 0 && keys.every((key) => key.length >= KEY_LENGTH),
  );
}

// @gmacko/secrets — encrypted secret storage with policy enforcement.
//
// Public surface:
//   - `Secrets` / `layerSecrets` — Effect service for tenant-scoped secret
//     CRUD, envelope fetch, policy-enforcing decrypt + audit, and
//     audit-only usage marking.
//   - Tagged errors: `SecretNotFoundError`, `SecretNameConflictError`,
//     `PolicyDeniedError`, `MaxUsesExceededError`.
//   - Shapes: `SecretEnvelope`, `SecretsShape`, `CreateSecretInput`,
//     `DecryptForUseInput`, `DecryptForUseResult`.
//   - Crypto primitives `encryptSecretValue` / `decryptSecretValue` — exposed
//     so out-of-band callers (e.g. import scripts) can produce/consume
//     envelope records without reaching into the service layer. These read
//     `GMACKO_SECRET_ENCRYPTION_KEY` at call time.

export {
  Secrets,
  layerSecrets,
  SecretNotFoundError,
  SecretNameConflictError,
  PolicyDeniedError,
  MaxUsesExceededError,
} from "./secrets.js";
export type {
  SecretEnvelope,
  SecretsShape,
  CreateSecretInput,
  DecryptForUseInput,
  DecryptForUseResult,
} from "./secrets.js";

export {
  encryptSecretValue,
  decryptSecretValue,
} from "./crypt.js";
export type { EncryptedEnvelope } from "./crypt.js";

/** Package version/phase sentinel — kept for the Task 5 smoke test. */
export const __gmackoSecretsPhase = "6d" as const;

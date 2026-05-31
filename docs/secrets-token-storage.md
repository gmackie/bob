# Secrets And Token Storage

Bob encrypts git provider tokens, imported browser cookies, and session secrets
with AES-256-GCM before storing them in Postgres. Row keys are derived from the
configured token-vault key plus the row identifier, so ciphertext from one row
cannot be replayed against another row.

## Required Keys

Production deployments must set `AUTH_SECRET` and at least one token-vault
encryption key:

```bash
AUTH_SECRET="$(openssl rand -base64 32)"
GIT_TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

`AUTH_SECRET` signs Better Auth cookies and session state. `GIT_TOKEN_ENCRYPTION_KEY`
protects git provider tokens, browser cookies, and session secrets.

## Rotation

For token-vault rotation, set `GIT_TOKEN_ENCRYPTION_KEYS` to a comma-separated
keyring with the new key first and retired keys after it:

```bash
GIT_TOKEN_ENCRYPTION_KEYS="new_key_material,previous_key_material"
```

New encryptions use the first key. Decryption tries each configured key in
order, which keeps existing tokens, cookies, and session secrets readable during
the rotation window. After all sensitive rows have been re-saved or expired,
remove retired keys from the keyring.

## Access Audit

Plaintext access is limited to trusted execution paths:

- Session secret plaintext access inserts a `session_secret_usages` audit row
  and updates `session_secrets.last_used_at`.
- Browser cookie access is scoped per session and writes a `cookie_access`
  entry to the session event stream. The event records domain, cookie count,
  and API key id only; it never stores cookie values.

## Retention

Session secrets are session scoped by default and should be deleted when no
longer needed. Promoting a session secret to a deploy environment moves the
long-term secret into ForgeGraph and leaves Bob with only the external
reference. Imported browser cookies should be removed from Settings after the
session or domain-specific task no longer needs them.

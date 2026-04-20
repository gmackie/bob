# Phase 6D — `@gmacko/secrets` + `projects` primitive

Port Bob's session-secret vault + service into gmacko, introduce the `projects` shared primitive, and tighten `project_deploy_secret_bindings` to reference `projects.id` via FK. No project CRUD via RPC in 6D — that wires at 6J.

## Scope

**In scope (locked):**
- New `projects` schema: `(id, tenantId, slug, name, createdAt, updatedAt)` with `(tenantId, slug)` unique + cascade on tenant delete.
- Rewrite `project_deploy_secret_bindings.projectSlug` → `projectId uuid FK → projects.id ON DELETE CASCADE`. Unique binding becomes `(tenantId, projectId, deployEnvironment, deployEnvVarName)`.
- Migration 0003 with both changes.
- Port Bob's `sessionSecretVault.ts` (AES-256-GCM + per-secret HMAC-derived key) into `@gmacko/secrets`, env rename `GIT_TOKEN_ENCRYPTION_KEY` → `GMACKO_SECRET_ENCRYPTION_KEY`.
- `@gmacko/secrets` package with `Secrets` Effect service: `createSecret`, `listForTenant`, `getSecret` (envelope only), `decryptForUse` (policy + usesRemaining decrement + audit), `markSecretUsed` (audit-only), `deleteSecret`.
- `Projects` Effect service in `@gmacko/secrets` (sibling module): `createProject`, `listForTenant`, `getById`, `getBySlug`, `deleteProject`.
- `ProjectId` brand in `@gmacko/validators`.
- Public barrel + `layerSecrets` + `layerProjects` + combined `layerSecretsAndProjects` bundle.

**Deferred:**
- `project_deploy_secret_bindings` CRUD service — lands when app wiring (6J) needs it.
- Bob's `promoteSessionSecret` — product-specific; stays in Bob.
- `project_members` (per-project RBAC) — tenant_members is sufficient for MVP auth.
- Extension fields on projects (workspace/ForgeGraph/automation/etc.) — Bob migrates those downstream in its own tables.
- KMS integration — single master key with HMAC-derived row keys stays the primitive.

## Exit criteria

- 31 packages (unchanged). `pnpm -r typecheck` green.
- Full test suite ≥ 175 tests passing (up from 150). Breakdown:
  - Baseline 6C: 150
  - Task 1 (projects schema): +4
  - Task 2 (bindings rewrite): +2
  - Task 4 (vault crypto): +5
  - Task 5 (pkg scaffold): +1
  - Task 6 (createSecret/delete/listForTenant): +6
  - Task 7 (getSecret): +3
  - Task 8 (decryptForUse + policy): +7
  - Task 9 (markSecretUsed): +2
  - Task 10 (Projects service): +6
  - Task 11 (barrel + layer bundle): +2
  - **Expected total: ~188** (comfortably > 175).
- Migration `0003_*.sql` applies cleanly to fresh PGlite + idempotent on re-apply (verified by `migrate.test.ts` unchanged).
- `GMACKO_SECRET_ENCRYPTION_KEY` env var required at service construction; missing/short key throws a clear error.
- `decryptForUse` enforces `allowedTemplates`, `allowedArgPrefixes`, and `usesRemaining` atomically (tests prove race safety on concurrent decrypts).

## Design decisions (locked for this phase)

- **Crypto.** One master key in env; per-secret row key via `HMAC-SHA256(master, "session-secret:" + secretId)`; AES-256-GCM with 96-bit IV; ciphertext/iv/tag base64. Bob's pattern, ported verbatim modulo env-name rename.
- **Tenant scoping.** Service methods take explicit `{ tenantId, userId? }` — authorization lives at the RPC layer (6J) via `CurrentUser`. Matches `ApiKeys.issueKey`.
- **API split.** `getSecret` returns envelope + policy only (no decryption); `decryptForUse` is the one entry point that returns plaintext + writes an audit row + decrements `usesRemaining`. Callers who want plaintext must go through policy.
- **usesRemaining semantics.** `integer | null`. `null` = unlimited. `decryptForUse` reads + checks + decrements in a single transaction using a conditional UPDATE: `UPDATE ... SET uses_remaining = uses_remaining - 1 WHERE id = $id AND (uses_remaining IS NULL OR uses_remaining > 0) RETURNING *`. If zero rows returned → `MaxUsesExceededError`.
- **Audit row.** Always written on `decryptForUse`, regardless of policy outcome. Written with `success: false` on policy failure so audits capture attempted misuse. `markSecretUsed` remains for callers that already hold plaintext (e.g. decrypt-once-reuse-many executor patterns) and just want to log.
- **Policy shape.** Start with flat `SessionSecretPolicy` already in the schema: `{ allowedTemplates?: string[], allowedArgPrefixes?: Record<string, string[]>, maxUses?: number, redactOutput?: boolean }`. Bob's nested `templatePolicies` shape is a widening for later if needed.
- **Project primitive.** Minimum viable — no extension fields. Bob adds workspace/ForgeGraph/automation in its own downstream table. OODA adds vault/repo in its own table.
- **FK rewrite migration.** Zero production data exists (package unreleased); migration 0003 can drop-and-recreate the `projectSlug` column → `projectId uuid FK` without data preservation. Simpler than a multi-step ALTER.

## Effect 4 API additions

None. 6D touches only APIs already in the master plan reference table: `ServiceMap.Service`, `Layer.effect` / `Layer.succeed`, `Schema.TaggedErrorClass`, `Schema.brand`, `Schema.Literals`, `Effect.gen` / `Effect.promise` / `Effect.catchTag`, drizzle ops (`eq`, `and`, `sql`), `node:crypto` stdlib. Confirmed during preemptive drift check.

## Task breakdown

Each task = RED → GREEN → COMMIT, one subagent per task (subagent-driven-development), strict TDD.

### Task 1: `projects` schema + round-trip tests

Create `packages/db/src/schema/projects.ts`:
```ts
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 128 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => ({
  tenantIdIdx: index("projects_tenant_id_idx").on(t.tenantId),
  uniqueTenantSlug: unique("projects_tenant_slug_unique").on(t.tenantId, t.slug),
}));
```

Add to `packages/db/src/schema/index.ts`. Add `./schema/projects` subpath in `@gmacko/db/package.json`.

`packages/db/src/schema/__tests__/projects.test.ts` — 4 tests:
1. insert + query round-trip
2. unique (tenantId, slug) constraint
3. cascade on tenant delete
4. different tenants can share slugs

Also add `ProjectId` to `packages/validators/src/ids.ts` (UuidString + brand).

Commit: `feat(db): add projects schema + ProjectId validator`

### Task 2: Rewrite `project_deploy_secret_bindings.projectSlug` → `projectId FK`

Edit `packages/db/src/schema/secrets.ts`:
- Drop `projectSlug: varchar(128)`.
- Add `projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" })`.
- Update unique constraint: `(tenantId, projectId, deployEnvironment, deployEnvVarName)`.
- Update index on `projectId` (replacing the implicit `projectSlug` scan pattern).

Update `packages/db/src/schema/__tests__/secrets.test.ts` binding tests: seed a project first, bind by `projectId`. Add 2 new tests:
1. cascade: deleting a project deletes its bindings
2. unique (tenantId, projectId, deployEnvironment, deployEnvVarName) rejects dup

Commit: `refactor(db): project_deploy_secret_bindings.projectSlug → projectId FK`

### Task 3: Generate migration `0003_*.sql`

Run `pnpm --filter @gmacko/db db:generate`. Expect: (a) CREATE TABLE projects + unique + index, (b) ALTER on project_deploy_secret_bindings (DROP projectSlug, ADD projectId FK). Verify by inspection + running the migration idempotency test + full db test suite.

Commit: `chore: generate drizzle migration 0003 (projects + bindings FK)`

### Task 4: Port vault crypto to `@gmacko/secrets/crypt.ts`

Create `packages/secrets/src/crypt.ts` mirroring Bob's `sessionSecretVault.ts`:
- `encryptSecretValue(plaintext: string, secretId: string): { ciphertext, iv, tag }` (all base64)
- `decryptSecretValue(envelope, secretId): string`
- Master key read from `process.env.GMACKO_SECRET_ENCRYPTION_KEY`; throw if missing or `< 32` chars
- `deriveRowKey(master, secretId)` via `HMAC-SHA256(master, "session-secret:" + secretId).subarray(0, 32)`
- AES-256-GCM with 12-byte IV via `randomBytes(12)`

Tests — 5 cases:
1. round-trip: encrypt then decrypt returns the plaintext
2. different secretIds produce different ciphertexts for the same plaintext + key (HMAC-derived keys)
3. decryption with wrong secretId fails with auth-tag error
4. missing env var throws with clear message
5. env var shorter than 32 chars throws with clear message

Commit: `feat(secrets): port vault crypto with GMACKO_SECRET_ENCRYPTION_KEY env`

### Task 5: Scaffold `@gmacko/secrets` package

Update `packages/secrets/package.json`:
- deps: `effect@4.0.0-beta.43`, `@gmacko/db`, `@gmacko/validators` workspace, `drizzle-orm`
- devDeps: `@gmacko/tsconfig`, `@effect/vitest`, `@electric-sql/pglite`, `@types/node`, `typescript`, `vitest`
- scripts: `test`, `typecheck`
- exports: `.` only (barrel lands in Task 11)

Create `vitest.config.ts` pointing tsconfig paths at workspace roots. Run `pnpm install` in the worktree.

Smoke test (`src/__tests__/package.test.ts`): import `__gmackoSecretsPhase` sentinel; assert `=== "6d"`.

Commit: `chore: scaffold @gmacko/secrets package (deps, tsconfig, vitest, smoke)`

### Task 6: `Secrets` service — create/delete/listForTenant

`packages/secrets/src/secrets.ts`:
```ts
export class SecretNotFoundError extends Schema.TaggedErrorClass<SecretNotFoundError>()(...)
export class SecretNameConflictError extends Schema.TaggedErrorClass<SecretNameConflictError>()(...)

export interface SecretEnvelope {
  readonly id: SessionSecretId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly policy: SessionSecretPolicy;
  readonly usesRemaining: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SecretsShape {
  readonly createSecret: (input: { tenantId, name, plaintext, policy?, usesRemaining? }) => Effect<SecretEnvelope, SecretNameConflictError>;
  readonly deleteSecret: (input: { secretId, tenantId }) => Effect<void, SecretNotFoundError>;
  readonly listForTenant: (tenantId) => Effect<readonly SecretEnvelope[], never>;
  // getSecret + decryptForUse + markSecretUsed land in Tasks 7-9
}

export class Secrets extends ServiceMap.Service<Secrets, SecretsShape>()("@gmacko/secrets/Secrets") {}
export const layerSecrets: Layer.Layer<Secrets, never, GmackoDb> = Layer.effect(Secrets)(...);
```

Implementation: inside the Layer's effect, `createSecret` calls `encryptSecretValue` with a freshly-generated UUID for the secretId, inserts `{ id, tenantId, name, ciphertext, iv, authTag, policy: policy ?? {}, usesRemaining: usesRemaining ?? null }`. On duplicate `(tenantId, name)` → `SecretNameConflictError` (catch drizzle unique constraint). `deleteSecret` does `DELETE ... WHERE id=$id AND tenantId=$tenantId RETURNING *`; zero rows → `SecretNotFoundError`. `listForTenant` selects envelope fields only (no ciphertext/iv/authTag).

Tests — 6 cases:
1. createSecret round-trips an envelope (plaintext NOT in returned envelope)
2. createSecret with `(tenantId, name)` duplicate → SecretNameConflictError
3. createSecret persists ciphertext that decrypts to plaintext (use vault directly to verify)
4. deleteSecret rejects when secretId doesn't exist or belongs to another tenant (cross-tenant hardening)
5. listForTenant returns only the calling tenant's secrets
6. listForTenant returns usesRemaining=null for unlimited and the concrete number otherwise

Commit: `feat(secrets): add Secrets service (createSecret, deleteSecret, listForTenant)`

### Task 7: `getSecret` — envelope-only lookup

Extend `Secrets` with `getSecret(input: { secretId, tenantId }) → Effect<SecretEnvelope, SecretNotFoundError>`. Selects envelope fields with tenant-scoped WHERE. No decryption, no audit write.

Tests — 3 cases:
1. getSecret returns the envelope for an existing tenant-owned secret
2. getSecret for a non-existent id → SecretNotFoundError
3. getSecret for another tenant's secret → SecretNotFoundError (cross-tenant hardening)

Commit: `feat(secrets): add getSecret (envelope-only tenant-scoped lookup)`

### Task 8: `decryptForUse` — policy + usesRemaining + audit

Extend `Secrets` with:
```ts
decryptForUse(input: {
  secretId: SessionSecretId;
  tenantId: TenantId;
  templateId?: string;      // gated by allowedTemplates
  args?: string[];          // checked against allowedArgPrefixes[templateId]
  sessionId?: SessionId;    // written to audit row
}) => Effect<
  { plaintext: string; envelope: SecretEnvelope },
  SecretNotFoundError | PolicyDeniedError | MaxUsesExceededError
>
```

New errors:
- `PolicyDeniedError { reason: "template" | "argPrefix" | "noTemplateId", templateId?, expected?: string[] }`
- `MaxUsesExceededError { secretId, maxUses }`

Flow:
1. Atomic guard: `UPDATE session_secrets SET uses_remaining = (CASE WHEN uses_remaining IS NULL THEN NULL ELSE uses_remaining - 1 END), updated_at = now() WHERE id = $id AND tenant_id = $tenantId AND (uses_remaining IS NULL OR uses_remaining > 0) RETURNING *`.
2. Zero rows → distinguish between missing (SELECT to confirm) → `SecretNotFoundError` vs. `uses_remaining = 0` → `MaxUsesExceededError`.
3. Check policy.allowedTemplates: if non-empty, `templateId` must be present + included. On fail: write audit row `{ success: false, templateId, commandPrefix: args?.[0] }` then `PolicyDeniedError`.
4. Check policy.allowedArgPrefixes: if templateId's entry exists, at least one arg must start with one of the configured prefixes. On fail: write audit row `{ success: false }` then `PolicyDeniedError`.
5. Policy passes → decrypt via `decryptSecretValue(envelope, secretId)` → write audit row `{ success: true, sessionId, templateId, commandPrefix: args?.[0] }` → return `{ plaintext, envelope }`.

Wrap the whole thing in a drizzle transaction so policy-check rollback reverts the usesRemaining decrement.

Tests — 7 cases:
1. happy path: no policy, unlimited uses → returns plaintext + audit row written with success=true
2. allowedTemplates enforced: templateId in list → succeeds
3. allowedTemplates enforced: templateId not in list → PolicyDeniedError, audit row success=false, usesRemaining unchanged
4. allowedArgPrefixes enforced: args[0] starts with configured prefix → succeeds
5. allowedArgPrefixes enforced: args[0] doesn't match any prefix → PolicyDeniedError
6. usesRemaining=1 → first decryptForUse succeeds, usesRemaining becomes 0; second → MaxUsesExceededError
7. usesRemaining=null (unlimited) → 3 successive decryptForUse calls succeed, usesRemaining stays null

Commit: `feat(secrets): add decryptForUse (policy + atomic usesRemaining + audit)`

### Task 9: `markSecretUsed` — audit-only primitive

Extend `Secrets` with `markSecretUsed(input: { secretId, tenantId, sessionId?, templateId?, commandPrefix?, success? }) → Effect<void, SecretNotFoundError>`. Verifies tenant ownership via SELECT, writes a `session_secret_usages` row. Does NOT decrement usesRemaining (that's `decryptForUse`'s job).

Tests — 2 cases:
1. markSecretUsed writes a usage row for a tenant-owned secret
2. markSecretUsed for another tenant's secret → SecretNotFoundError

Commit: `feat(secrets): add markSecretUsed (audit-only primitive)`

### Task 10: `Projects` service

`packages/secrets/src/projects.ts`:
```ts
export class ProjectNotFoundError extends Schema.TaggedErrorClass<...>()(...)
export class ProjectSlugConflictError extends Schema.TaggedErrorClass<...>()(...)

export interface Project {
  readonly id: ProjectId;
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectsShape {
  readonly createProject: (input: { tenantId, slug, name }) => Effect<Project, ProjectSlugConflictError>;
  readonly listForTenant: (tenantId) => Effect<readonly Project[], never>;
  readonly getById: (input: { projectId, tenantId }) => Effect<Project, ProjectNotFoundError>;
  readonly getBySlug: (input: { tenantId, slug }) => Effect<Project, ProjectNotFoundError>;
  readonly deleteProject: (input: { projectId, tenantId }) => Effect<void, ProjectNotFoundError>;
}

export class Projects extends ServiceMap.Service<Projects, ProjectsShape>()("@gmacko/secrets/Projects") {}
export const layerProjects: Layer.Layer<Projects, never, GmackoDb> = Layer.effect(Projects)(...);
```

Tests — 6 cases:
1. createProject round-trip
2. createProject with duplicate (tenantId, slug) → ProjectSlugConflictError
3. createProject: different tenants can share a slug
4. getById + getBySlug + listForTenant all tenant-scoped
5. deleteProject for a project owned by another tenant → ProjectNotFoundError
6. deleteProject cascades to project_deploy_secret_bindings (schema-level, via cascade test)

Commit: `feat(secrets): add Projects service (CRUD, tenant-scoped)`

### Task 11: Public barrel + layer bundle

`packages/secrets/src/index.ts`:
- Re-export `Secrets`, `layerSecrets`, all secrets errors + types
- Re-export `Projects`, `layerProjects`, all projects errors + types
- Export crypto primitives `encryptSecretValue` / `decryptSecretValue` (some callers may want to encrypt out-of-band — e.g. import scripts)
- `layerSecretsAndProjects: Layer.Layer<Secrets | Projects, never, GmackoDb>` = `Layer.merge(layerSecrets, layerProjects)`
- `__gmackoSecretsPhase = "6d"` sentinel

Update `packages/secrets/package.json` exports with `.`, `./crypt`.

Tests — 2 cases:
1. package.test.ts (already from Task 5): `__gmackoSecretsPhase === "6d"` — passes
2. New `layer.test.ts`: provide `layerSecretsAndProjects` with `layerGmackoDb` and verify both services resolve.

Commit: `feat(secrets): finalize public barrel + layerSecretsAndProjects bundle`

### Task 12: Exit verification + tag

1. `pnpm -r --filter '!./apps/*' typecheck` green
2. `pnpm --filter @gmacko/db test && pnpm --filter @gmacko/secrets test && pnpm -r --filter '!@gmacko/db' --filter '!@gmacko/secrets' --filter '!./apps/*' test` all green, ≥ 175 total
3. Migration idempotency (`migrate.test.ts`) passes against all three migrations
4. Git tree clean
5. Tag `phase-6d-complete`
6. Append "Phase 6D — Completed" section to this plan doc with actuals
7. Commit docs update + merge to master + push tag (handled by wrapper)

---

## Open items carried into 6E onboarding

- `session_secret_usages.sessionId` still bare UUID (6B carry-forward). 6E (agent session primitive) promotes to `ON DELETE SET NULL` FK referencing `chat_conversations.id` once the agent layer exercises secrets.
- `project_deploy_secret_bindings` CRUD service — defer to 6J app wiring.
- Policy widening (Bob's `templatePolicies` nested shape) — only widen when Bob migrates on top of gmacko and surfaces the need.
- KMS integration — wait until the master key rotation story becomes a real concern.

## Convention reinforced

- Each task = RED → GREEN → COMMIT with a dedicated subagent.
- Envelope encryption with HMAC-derived row keys stays the gmacko primitive until KMS is unavoidable.
- Projects = minimum shared primitive; product-specific extensions live in the product's own downstream tables.

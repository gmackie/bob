# Bob Session Secrets Container Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user paste a secret into Bob, attach it to a single agent session by default, let the agent use it without ever seeing plaintext in chat/tool output, and optionally promote it into ForgeGraph deployment-environment secrets later.

**Architecture:** Bob stores pasted session secrets encrypted at rest, scoped to a single `chat_conversations` session. The gateway exposes a session-scoped broker/helper CLI that can apply those secrets only through constrained execution templates or transport adapters, instead of injecting raw env vars into the agent shell. Promotion to ForgeGraph copies a selected session secret into a ForgeGraph deploy-environment secret binding (`dev`, `staging`, `prod`, `preview`) and replaces Bob-side usage with an external reference.

**Tech Stack:** Next.js app router, React, tRPC, Drizzle/Postgres schema in `packages/db`, Bob gateway in `apps/gateway`, existing AES-256-GCM vault helpers in `packages/api/src/services/crypto`, ForgeGraph HTTP client in `packages/api/src/services/forgegraph/forgeGraphClient.ts`.

## Non-goals

- Do not add a generic "read secret" tool.
- Do not inject raw secret env vars into the long-lived agent process.
- Do not expose plaintext secrets in session transcripts, tool results, browser responses, or logs.
- Do not tie this feature to workflow stages like `idea` or `plan`; promotion is for ForgeGraph deploy environments.

## Why existing CLIs are not sufficient on their own

- Tools like `op run`, `doppler run`, `infisical run`, `aws-vault exec`, and `chamber exec` are strong building blocks for human-driven subprocess injection.
- They do not satisfy Bob's threat model by themselves once the agent already has arbitrary shell access, because the agent can deliberately run `env`, `printenv`, `cat`, or a shell wrapper that echoes the secret.
- The closest pattern to Bob's requirement is 1Password's agentic autofill model: approve a bounded capability, inject only the minimum data, and do not hand raw secret material to the agent.
- Bob therefore needs a control plane plus a constrained execution plane, not only a secret provider CLI.

## Current codebase facts that matter

- Session state already exists in `packages/db/src/schema.ts` under `chatConversations`, `sessionEvents`, and `sessionConnections`.
- The web product already has a secret-adjacent, scope-aware pattern in `packages/api/src/router/cookies.ts` and `apps/web/src/app/(dashboard)/settings/_components/cookie-jar.tsx`.
- The gateway currently observes tool calls in `apps/gateway/src/agents/agent-process-manager.ts`, but it does not send Bob-generated tool results back into the agent runtime. Do not assume a new Bob gateway tool is enough by itself.
- ForgeGraph integration in Bob currently covers work items, artifacts, dependencies, builds, deployments, and run events, but there is no secret-store client method yet in `packages/api/src/services/forgegraph/forgeGraphClient.ts`.

## Recommended product shape

### Session-scoped default

- The session header gets a `Secrets` button.
- Users paste a secret value, give it a human label, choose a transport mode, and optionally pick a safe template.
- Bob stores the value encrypted and returns only metadata plus an opaque handle to the UI and agent session.

### Safe execution model

- The agent does not receive plaintext.
- The agent receives a session-local helper command plus allowed handles/templates.
- The helper command can:
  - execute a fixed template with env/stdin/file injection hidden from the agent
  - make an authenticated HTTP request directly
  - materialize a temporary file only for the child process lifetime
- The helper command cannot:
  - print the stored value
  - list all secret plaintexts
  - run arbitrary shell with unrestricted env injection

### ForgeGraph promotion

- The user can promote a session secret into a project-level ForgeGraph deploy secret for `dev`, `staging`, `prod`, or `preview`.
- After promotion, the project settings page shows the binding and the Bob session can reference the external secret without re-pasting it.

## Task 1: Add database tables for session secrets, usage audit, and project deploy bindings

**Files:**
- Modify: `packages/db/src/schema.ts`
- Test: `packages/api/src/router/__tests__/secrets.test.ts`

**Step 1: Write the failing schema-driven router test**

Add assertions that Bob can create:

- one session secret tied to `chat_conversations.id`
- one usage audit row tied to the secret and session
- one project deploy binding tied to `projects.id`

The test should fail because the new tables do not exist.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/api test -- secrets`

Expected: FAIL with schema/table errors.

**Step 3: Add the tables in `packages/db/src/schema.ts`**

Add:

```ts
export const sessionSecrets = pgTable("session_secrets", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: t.uuid().notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  workspaceId: t.uuid().references(() => workspaces.id, { onDelete: "set null" }),
  projectId: t.uuid().references(() => projects.id, { onDelete: "set null" }),
  label: t.varchar({ length: 128 }).notNull(),
  handle: t.varchar({ length: 64 }).notNull(),
  transport: t.varchar({ length: 32 }).notNull().default("template"),
  source: t.varchar({ length: 32 }).notNull().default("pasted"),
  provider: t.varchar({ length: 32 }).notNull().default("bob"),
  status: t.varchar({ length: 20 }).notNull().default("active"),
  valueCiphertext: t.text(),
  valueIv: t.text(),
  valueTag: t.text(),
  policy: t.jsonb().$type<{
    allowedTemplates?: string[];
    redactOutput?: boolean;
    maxUses?: number | null;
  }>().notNull().default({}),
  externalRef: t.text(),
  expiresAt: t.timestamp({ mode: "date", withTimezone: true }),
  lastUsedAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
}), (table) => [
  index("session_secrets_session_idx").on(table.sessionId),
  index("session_secrets_project_idx").on(table.projectId),
  { name: "session_secrets_session_handle_unique", columns: [table.sessionId, table.handle], unique: true },
]);
```

Add:

```ts
export const sessionSecretUsages = pgTable("session_secret_usages", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  secretId: t.uuid().notNull().references(() => sessionSecrets.id, { onDelete: "cascade" }),
  sessionId: t.uuid().notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  executor: t.varchar({ length: 32 }).notNull(),
  templateId: t.varchar({ length: 64 }),
  commandPreview: t.text(),
  exitCode: t.integer(),
  durationMs: t.integer(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));
```

Add:

```ts
export const projectDeploySecretBindings = pgTable("project_deploy_secret_bindings", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  projectId: t.uuid().notNull().references(() => projects.id, { onDelete: "cascade" }),
  environment: t.varchar({ length: 20 }).notNull(),
  label: t.varchar({ length: 128 }).notNull(),
  forgegraphKey: t.varchar({ length: 128 }).notNull(),
  externalRef: t.text().notNull(),
  transport: t.varchar({ length: 32 }).notNull().default("template"),
  templateId: t.varchar({ length: 64 }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
}), (table) => [
  { name: "project_deploy_secret_env_key_unique", columns: [table.projectId, table.environment, table.forgegraphKey], unique: true },
]);
```

**Step 4: Run the failing router test again**

Run: `pnpm --filter @bob/api test -- secrets`

Expected: FAIL later in the router because the router does not exist yet.

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add session secret schema"
```

## Task 2: Add crypto helpers for session secret values

**Files:**
- Create: `packages/api/src/services/crypto/sessionSecretVault.ts`
- Test: `packages/api/src/services/crypto/__tests__/sessionSecretVault.test.ts`

**Step 1: Write the failing crypto test**

Cover:

- encrypt/decrypt round trip
- wrong row id fails
- tampered ciphertext fails

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/api test -- sessionSecretVault`

Expected: FAIL because the helper file does not exist.

**Step 3: Implement the helper**

Copy the pattern from `packages/api/src/services/crypto/cookieVault.ts`, but derive keys with a `session-secret:` prefix:

```ts
function deriveSessionSecretKey(masterKey: Buffer, secretId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(`session-secret:${secretId}`)
    .digest()
    .subarray(0, KEY_LENGTH);
}
```

Export:

- `encryptSessionSecretValue`
- `decryptSessionSecretValue`

Reuse `GIT_TOKEN_ENCRYPTION_KEY` for the MVP instead of introducing a second master key.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @bob/api test -- sessionSecretVault`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/api/src/services/crypto/sessionSecretVault.ts packages/api/src/services/crypto/__tests__/sessionSecretVault.test.ts
git commit -m "feat: add session secret encryption helpers"
```

## Task 3: Add a secrets router and service layer

**Files:**
- Create: `packages/api/src/services/secrets/sessionSecretService.ts`
- Create: `packages/api/src/router/secrets.ts`
- Modify: `packages/api/src/root.ts`
- Test: `packages/api/src/router/__tests__/secrets.test.ts`

**Step 1: Write the failing router test**

Cover:

- create a session secret for a user-owned session
- list secrets without plaintext
- reject creation for a session owned by another user
- delete a secret
- log a usage audit row

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/api test -- secrets`

Expected: FAIL because `secretsRouter` is missing.

**Step 3: Implement `sessionSecretService.ts`**

Create methods:

- `createSessionSecret`
- `listSessionSecrets`
- `deleteSessionSecret`
- `markSecretUsed`
- `getSecretForExecution`

`getSecretForExecution` is server-only and returns plaintext after decrypting. It must never be exposed through the protected router response type.

**Step 4: Implement `packages/api/src/router/secrets.ts`**

Add protected procedures:

```ts
createSessionSecret
listSessionSecrets
deleteSessionSecret
promoteSessionSecret
listProjectDeployBindings
upsertProjectDeployBinding
deleteProjectDeployBinding
```

For `createSessionSecret`, input should look like:

```ts
z.object({
  sessionId: z.string().uuid(),
  label: z.string().min(1).max(128),
  handle: z.string().min(1).max(64).regex(/^[a-z0-9-_]+$/),
  value: z.string().min(1),
  transport: z.enum(["template", "http", "stdin", "file"]).default("template"),
  policy: z.object({
    allowedTemplates: z.array(z.string()).default([]),
    redactOutput: z.boolean().default(true),
    maxUses: z.number().int().positive().nullable().optional(),
  }).default({ allowedTemplates: [], redactOutput: true }),
})
```

Do not return `value`.

**Step 5: Register the router**

Add `secrets: secretsRouter` in `packages/api/src/root.ts`.

**Step 6: Run tests**

Run: `pnpm --filter @bob/api test -- secrets`

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/api/src/services/secrets/sessionSecretService.ts packages/api/src/router/secrets.ts packages/api/src/root.ts packages/api/src/router/__tests__/secrets.test.ts
git commit -m "feat: add session secrets api"
```

## Task 4: Extend the ForgeGraph client for deploy-environment secret promotion

**Files:**
- Modify: `packages/api/src/services/forgegraph/forgeGraphClient.ts`
- Create: `packages/api/src/services/secrets/forgegraphSecretAdapter.ts`
- Test: `packages/api/src/router/__tests__/secrets.test.ts`

**Step 1: Write the failing promotion test**

Add a test that promotion:

- calls the ForgeGraph secret API adapter
- records the external reference in Bob
- creates or updates `projectDeploySecretBindings`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/api test -- secrets`

Expected: FAIL because the client methods do not exist.

**Step 3: Extend `ForgeGraphClient`**

Add placeholder methods matching the expected ForgeGraph contract:

```ts
async upsertDeploySecret(input: {
  projectId: string;
  environment: "dev" | "staging" | "prod" | "preview";
  key: string;
  value: string;
}): Promise<{ ref: string }>

async listDeploySecrets(input: {
  projectId: string;
  environment?: "dev" | "staging" | "prod" | "preview";
}): Promise<Array<{ key: string; ref: string; updatedAt: string }>>
```

Use a dedicated adapter service so the HTTP shape is isolated in one file.

**Step 4: Implement promotion in `secretsRouter`**

`promoteSessionSecret` should:

- verify project ownership through the session or project
- decrypt Bob's stored value
- call `upsertDeploySecret`
- set `sessionSecrets.status = "promoted"`
- set `sessionSecrets.provider = "forgegraph"`
- set `sessionSecrets.externalRef`
- create or upsert `projectDeploySecretBindings`

**Step 5: Run tests**

Run: `pnpm --filter @bob/api test -- secrets`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/api/src/services/forgegraph/forgeGraphClient.ts packages/api/src/services/secrets/forgegraphSecretAdapter.ts packages/api/src/router/secrets.ts packages/api/src/router/__tests__/secrets.test.ts
git commit -m "feat: add forgegraph secret promotion flow"
```

## Task 5: Build the gateway-side session broker and helper CLI

**Files:**
- Create: `apps/gateway/src/secrets/sessionSecretBroker.ts`
- Create: `apps/gateway/src/secrets/executionTemplates.ts`
- Create: `apps/gateway/src/bin/bob-session-secret.ts`
- Modify: `apps/gateway/src/index.ts`
- Modify: `apps/gateway/src/agents/agent-process-manager.ts`
- Test: `apps/gateway/src/agents/__tests__/agent-process-manager.test.ts`

**Step 1: Write the failing gateway test**

Cover:

- the gateway creates a session-scoped broker token
- the helper can execute an allowed template with a secret handle
- the helper rejects unknown handles
- the helper rejects arbitrary shell templates

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/gateway test -- agent-process-manager`

Expected: FAIL because the broker/helper does not exist.

**Step 3: Implement the execution template registry**

Create a small registry like:

```ts
export const EXECUTION_TEMPLATES = {
  "http-bearer": { kind: "http" },
  "docker-login": { kind: "stdin", command: ["docker", "login", "--username", "{{arg:username}}", "--password-stdin", "{{arg:registry}}"] },
  "gh-api": { kind: "env-fixed", command: ["gh", "api", "{{arg:path}}"] },
} as const;
```

Rules:

- template id must be chosen by Bob or the user UI, not by opaque shell text
- `env-fixed` only works with an allowlisted executable, never `sh`, `bash`, or `node -e`
- stdout/stderr must be scrubbed for the secret value before returning

**Step 4: Implement the session broker**

Responsibilities:

- accept a signed short-lived session broker token
- fetch plaintext via server-only `getSecretForExecution`
- execute only approved transport kinds
- record usage via `sessionSecretUsages`
- redact output before printing

**Step 5: Expose the helper to the agent session**

In `apps/gateway/src/index.ts` or `apps/gateway/src/agents/agent-process-manager.ts`, add launch env such as:

```ts
{
  BOB_SESSION_SECRET_BROKER_URL: "...",
  BOB_SESSION_SECRET_TOKEN: "...",
}
```

Do not put secret handles or values in env vars unless they are non-sensitive metadata.

**Step 6: Run tests**

Run: `pnpm --filter @bob/gateway test -- agent-process-manager`

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/gateway/src/secrets/sessionSecretBroker.ts apps/gateway/src/secrets/executionTemplates.ts apps/gateway/src/bin/bob-session-secret.ts apps/gateway/src/index.ts apps/gateway/src/agents/agent-process-manager.ts apps/gateway/src/agents/__tests__/agent-process-manager.test.ts
git commit -m "feat: add session secret broker for agent sessions"
```

## Task 6: Add session-level web UI for paste, audit, and promote

**Files:**
- Create: `apps/web/src/app/(dashboard)/chat/_components/session-secrets-sheet.tsx`
- Modify: `apps/web/src/app/(dashboard)/chat/_components/session-header.tsx`
- Modify: `apps/web/src/components/chat/chat-panel.tsx`
- Test: `apps/web/src/app/__tests__/session-header-copy.test.ts`

**Step 1: Write the failing component test**

Cover:

- `Secrets` button renders in the session header
- opening the sheet lists existing handles
- submitting the form calls `trpc.secrets.createSessionSecret`
- plaintext value is not rendered after successful submit

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- session-header`

Expected: FAIL because the button and sheet do not exist.

**Step 3: Build the sheet UI**

UI fields:

- label
- handle
- secret value textarea with paste support
- transport select
- template allowlist select when `transport === "template"`
- optional `Promote to ForgeGraph later` hint text

The list view should show:

- label
- handle
- transport
- status
- last used time
- `Promote` action
- `Delete` action

Never render the stored plaintext after submit.

**Step 4: Wire the sheet into the session header**

Add a compact button near stop/restart controls in `session-header.tsx`.

**Step 5: Run tests**

Run: `pnpm --filter web test -- session-header`

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/chat/_components/session-secrets-sheet.tsx apps/web/src/app/\(dashboard\)/chat/_components/session-header.tsx apps/web/src/components/chat/chat-panel.tsx
git commit -m "feat: add session secret management ui"
```

## Task 7: Add project settings UI for ForgeGraph deploy secret bindings

**Files:**
- Create: `apps/web/src/components/projects/forgegraph-secret-settings.tsx`
- Modify: `apps/web/src/components/projects/project-detail-tabs.tsx`
- Modify: `apps/web/src/components/projects/automation-settings.tsx`

**Step 1: Write the failing project settings test**

Cover:

- the settings tab shows a `ForgeGraph Deploy Secrets` panel
- the panel lists `dev`, `staging`, `prod`, `preview`
- the panel shows existing bindings and allows remove/update

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- project`

Expected: FAIL because the panel does not exist.

**Step 3: Build the settings panel**

Add a separate project settings panel instead of overloading `AutomationSettings`.

Form rows:

- environment
- ForgeGraph secret key
- label
- transport
- template id

Show a note that users can promote a session secret into any of these bindings from an active session.

**Step 4: Render the panel in the project settings tab**

Place it under `AutomationSettings` in `project-detail-tabs.tsx`.

**Step 5: Run tests**

Run: `pnpm --filter web test -- project`

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/components/projects/forgegraph-secret-settings.tsx apps/web/src/components/projects/project-detail-tabs.tsx apps/web/src/components/projects/automation-settings.tsx
git commit -m "feat: add forgegraph deploy secret settings"
```

## Task 8: Add redaction and operational safeguards

**Files:**
- Modify: `apps/gateway/src/secrets/sessionSecretBroker.ts`
- Modify: `apps/gateway/src/agents/agent-process-manager.ts`
- Test: `apps/gateway/src/agents/__tests__/agent-process-manager.test.ts`

**Step 1: Write the failing redaction tests**

Cover:

- broker scrubs exact plaintext from stdout
- broker scrubs exact plaintext from stderr
- session event payloads never include plaintext
- usage audit still records metadata even when output is scrubbed

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/gateway test -- agent-process-manager`

Expected: FAIL because scrubber logic is incomplete.

**Step 3: Implement output scrubbing**

At minimum:

- exact plaintext replacement with `***`
- newline-preserving scrub for multiline secrets
- future-proof hook for additional derived forms

**Step 4: Run tests**

Run: `pnpm --filter @bob/gateway test -- agent-process-manager`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/gateway/src/secrets/sessionSecretBroker.ts apps/gateway/src/agents/agent-process-manager.ts apps/gateway/src/agents/__tests__/agent-process-manager.test.ts
git commit -m "fix: redact session secret material from broker output"
```

## Verification checklist

Run the full set before claiming completion:

```bash
pnpm --filter @bob/api test -- sessionSecretVault
pnpm --filter @bob/api test -- secrets
pnpm --filter @bob/gateway test -- agent-process-manager
pnpm --filter web test -- session-header
pnpm --filter web test -- project
pnpm lint
pnpm typecheck
```

Manual verification:

1. Start a chat session.
2. Open the new `Secrets` panel.
3. Paste a test token like `secret-demo-123`.
4. Confirm the UI shows only label/handle metadata after save.
5. Use the helper CLI with an allowlisted template.
6. Confirm the command succeeds and transcripts never show `secret-demo-123`.
7. Promote the secret to ForgeGraph `staging`.
8. Confirm the project settings page shows the binding and the Bob session shows provider `forgegraph`.
9. Delete the session secret and confirm the promoted external binding remains.

## Open questions to resolve before implementation

- Exact ForgeGraph secret-store API shape: Bob currently has no client method for this, so the endpoint contract must be confirmed before Task 4 lands.
- Distribution path for `bob-session-secret`: if the gateway host and agent runtime diverge, package the helper as an installable workspace binary instead of a gateway-only script.
- First safe template set: start small. Recommended MVP templates are `http-bearer`, `docker-login`, `gh-api`, and one temp-file template for kubeconfig or service-account JSON.

## Recommendation

Build the Bob-managed broker first, then optionally add provider adapters behind it:

1. Bob encrypted session vault
2. constrained helper CLI/broker
3. ForgeGraph promotion
4. optional provider-backed adapters for 1Password, Doppler, or Infisical later

Do not start with raw `op run` or `doppler run` inside the agent shell. That is convenient, but it does not meet the stated rule that the agent should be able to use a secret without being able to read it back.

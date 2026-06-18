// Tests for the secrets.session.* RPC sub-namespace (7B-4B Task 10).
//
// Validates:
//   1. All 14 procedures (6 original + 8 session) are wired into SecretsRpc.
//   2. Stub handlers return deterministic mock data that round-trips through
//      the declared success schemas.
//   3. Error channels on session stubs behave correctly.
import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema } from "effect";

import {
  SecretsRpc,
  // Original 6
  SecretsCreateRpc,
  SecretsListRpc,
  SecretsGetEnvelopeRpc,
  SecretsDecryptForUseRpc,
  SecretsMarkUsedRpc,
  SecretsDeleteRpc,
  // Session 8
  SecretsSessionGetManifestRpc,
  SecretsSessionGetForExecutionRpc,
  SecretsSessionCreateRpc,
  SecretsSessionListRpc,
  SecretsSessionDeleteRpc,
  SecretsSessionMarkUsedRpc,
  SecretsSessionUpsertDeployBindingRpc,
  SecretsSessionPromoteRpc,
} from "../groups/secrets.js";
import {
  SessionSecretSchema,
  SessionSecretManifestSchema,
  SessionSecretForExecutionSchema,
  SessionSecretUsageSchema,
  SessionSecretDeleteResultSchema,
  ProjectDeployBindingSchema,
} from "../schemas/secrets-session.js";
import {
  stubSecretsHandlers,
  STUB_SESSION_ID,
  STUB_SESSION_SECRET_ID,
  STUB_SESSION_SECRET_1,
  STUB_PROJECT_ID,
} from "../stubs/secrets.js";

describe("SecretsRpc — secrets.session.* (7B-4B Task 10)", () => {
  it("resolves all 14 declared procedures by tag", () => {
    const expectedTags = [
      // Original 6
      "secrets.create",
      "secrets.list",
      "secrets.getEnvelope",
      "secrets.decryptForUse",
      "secrets.markUsed",
      "secrets.delete",
      // Session 8
      "secrets.session.getManifest",
      "secrets.session.getForExecution",
      "secrets.session.create",
      "secrets.session.list",
      "secrets.session.delete",
      "secrets.session.markUsed",
      "secrets.session.upsertDeployBinding",
      "secrets.session.promote",
    ];

    // Verify individual _tag values
    expect(SecretsCreateRpc._tag).toBe("secrets.create");
    expect(SecretsListRpc._tag).toBe("secrets.list");
    expect(SecretsGetEnvelopeRpc._tag).toBe("secrets.getEnvelope");
    expect(SecretsDecryptForUseRpc._tag).toBe("secrets.decryptForUse");
    expect(SecretsMarkUsedRpc._tag).toBe("secrets.markUsed");
    expect(SecretsDeleteRpc._tag).toBe("secrets.delete");
    expect(SecretsSessionGetManifestRpc._tag).toBe("secrets.session.getManifest");
    expect(SecretsSessionGetForExecutionRpc._tag).toBe("secrets.session.getForExecution");
    expect(SecretsSessionCreateRpc._tag).toBe("secrets.session.create");
    expect(SecretsSessionListRpc._tag).toBe("secrets.session.list");
    expect(SecretsSessionDeleteRpc._tag).toBe("secrets.session.delete");
    expect(SecretsSessionMarkUsedRpc._tag).toBe("secrets.session.markUsed");
    expect(SecretsSessionUpsertDeployBindingRpc._tag).toBe("secrets.session.upsertDeployBinding");
    expect(SecretsSessionPromoteRpc._tag).toBe("secrets.session.promote");

    // Verify the group contains exactly 14 entries
    const requests = SecretsRpc.requests as Map<string, unknown>;
    for (const tag of expectedTags) {
      expect(requests.has(tag)).toBe(true);
    }
    expect(requests.size).toBe(14);
  });

  // --- secrets.session.getManifest ---

  it("stub secrets.session.getManifest returns manifest for known session", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.getManifest"]({
        sessionId: STUB_SESSION_ID,
      }) as Effect.Effect<readonly unknown[], never, never>,
    );
    expect(result.length).toBe(1);
    Schema.decodeUnknownSync(SessionSecretManifestSchema)(result);
  });

  it("stub secrets.session.getManifest fails with NotFoundError for unknown session", async () => {
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const exit = await Effect.runPromiseExit(
      stubSecretsHandlers["secrets.session.getManifest"]({
        sessionId: unknownId,
      }) as Effect.Effect<unknown, unknown, never>,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const rendered = JSON.stringify(exit.cause);
      expect(rendered).toContain("NotFoundError");
    }
  });

  // --- secrets.session.getForExecution ---

  it("stub secrets.session.getForExecution returns secret + value for known handle", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.getForExecution"]({
        sessionId: STUB_SESSION_ID,
        handle: "db-password",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    Schema.decodeUnknownSync(SessionSecretForExecutionSchema)(result);
    expect((result as any).value).toBe("stub-session-secret-value");
    expect((result as any).usageCount).toBe(0);
  });

  it("stub secrets.session.getForExecution fails for unknown handle", async () => {
    const exit = await Effect.runPromiseExit(
      stubSecretsHandlers["secrets.session.getForExecution"]({
        sessionId: STUB_SESSION_ID,
        handle: "nonexistent",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  // --- secrets.session.create ---

  it("stub secrets.session.create returns created secret", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.create"]({
        sessionId: STUB_SESSION_ID,
        label: "NEW_SECRET",
        handle: "new-secret",
        value: "s3cr3t",
      }) as Effect.Effect<unknown, never, never>,
    );
    Schema.decodeUnknownSync(SessionSecretSchema)(result);
    expect((result as any).label).toBe("NEW_SECRET");
    expect((result as any).handle).toBe("new-secret");
  });

  // --- secrets.session.list ---

  it("stub secrets.session.list returns secrets for known session", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.list"]({
        sessionId: STUB_SESSION_ID,
      }) as Effect.Effect<readonly unknown[], never, never>,
    );
    expect(result.length).toBe(1);
    Schema.decodeUnknownSync(SessionSecretManifestSchema)(result);
  });

  // --- secrets.session.delete ---

  it("stub secrets.session.delete succeeds for known secret", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.delete"]({
        secretId: STUB_SESSION_SECRET_ID,
      }) as Effect.Effect<unknown, unknown, never>,
    );
    Schema.decodeUnknownSync(SessionSecretDeleteResultSchema)(result);
    expect((result as any).deleted).toBe(1);
  });

  it("stub secrets.session.delete fails for unknown secret", async () => {
    const exit = await Effect.runPromiseExit(
      stubSecretsHandlers["secrets.session.delete"]({
        secretId: "unknown-id",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const rendered = JSON.stringify(exit.cause);
      expect(rendered).toContain("SecretNotFoundError");
    }
  });

  // --- secrets.session.markUsed ---

  it("stub secrets.session.markUsed returns usage record", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.markUsed"]({
        secretId: STUB_SESSION_SECRET_ID,
        sessionId: STUB_SESSION_ID,
        executor: "codex",
        templateId: "shell/exec",
      }) as Effect.Effect<unknown, never, never>,
    );
    Schema.decodeUnknownSync(SessionSecretUsageSchema)(result);
    expect((result as any).executor).toBe("codex");
  });

  // --- secrets.session.upsertDeployBinding ---

  it("stub secrets.session.upsertDeployBinding returns binding for known project", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.upsertDeployBinding"]({
        projectId: STUB_PROJECT_ID,
        environment: "prod",
        label: "DB_URL",
        forgegraphKey: "db-url",
        externalRef: "fg-ref-123",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    Schema.decodeUnknownSync(ProjectDeployBindingSchema)(result);
    expect((result as any).forgegraphKey).toBe("db-url");
  });

  it("stub secrets.session.upsertDeployBinding fails for unknown project", async () => {
    const exit = await Effect.runPromiseExit(
      stubSecretsHandlers["secrets.session.upsertDeployBinding"]({
        projectId: "00000000-0000-4000-8000-000000000000",
        environment: "prod",
        label: "DB_URL",
        forgegraphKey: "db-url",
        externalRef: "fg-ref-123",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  // --- secrets.session.promote ---

  it("stub secrets.session.promote returns promoted secret for known id", async () => {
    const result = await Effect.runPromise(
      stubSecretsHandlers["secrets.session.promote"]({
        secretId: STUB_SESSION_SECRET_ID,
        projectId: STUB_PROJECT_ID,
        environment: "prod",
        forgegraphKey: "db-password",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    Schema.decodeUnknownSync(SessionSecretSchema)(result);
    expect((result as any).status).toBe("promoted");
    expect((result as any).provider).toBe("forgegraph");
  });

  it("stub secrets.session.promote fails for unknown secret", async () => {
    const exit = await Effect.runPromiseExit(
      stubSecretsHandlers["secrets.session.promote"]({
        secretId: "unknown-id",
        projectId: STUB_PROJECT_ID,
        environment: "prod",
        forgegraphKey: "db-password",
      }) as Effect.Effect<unknown, unknown, never>,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const rendered = JSON.stringify(exit.cause);
      expect(rendered).toContain("SecretNotFoundError");
    }
  });
});

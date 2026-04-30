// Deterministic in-memory stubs for the SecretsRpc contract group. Lets OODA
// (and any other client) wire up typed calls against a fixed mock surface
// before real service handlers land in 6J. All IDs and timestamps are pinned
// so consumers can write golden-style tests.
//
// 7B-4B Task 10: adds stubs for 8 `secrets.session.*` procedures.
import { Effect } from "effect";

import { SecretNameConflictError, SecretNotFoundError } from "@gmacko/core/secrets/errors";
import { NotFoundError } from "@gmacko/core/rpc/errors";

import { SecretsRpc } from "../groups/secrets.js";
import type { SecretEnvelopeWire } from "../schemas/secrets.js";
import type {
  SessionSecretWire,
  SessionSecretUsageWire,
  SessionSecretForExecutionWire,
  ProjectDeployBindingWire,
  SessionSecretDeleteResultWire,
} from "../schemas/secrets-session.js";

// --- Fixtures ---

// Valid v4-shaped UUIDs so the SecretEnvelope schema's `isUUID` check passes.
// The version nibble (position 14) is `4` and the variant nibble (position 19)
// is one of `8/9/a/b`.
export const STUB_TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const STUB_SECRET_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STUB_SECRET_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STUB_SESSION_SECRET_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const STUB_SESSION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const STUB_PROJECT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const STUB_TIMESTAMP = new Date("2026-04-21T00:00:00.000Z");

export const STUB_SECRET_ENVELOPE_1: SecretEnvelopeWire = {
  id: STUB_SECRET_ID_1,
  tenantId: STUB_TENANT_ID,
  name: "GITHUB_TOKEN",
  policy: {},
  usesRemaining: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP,
};

export const STUB_SECRET_ENVELOPE_2: SecretEnvelopeWire = {
  id: STUB_SECRET_ID_2,
  tenantId: STUB_TENANT_ID,
  name: "OPENAI_API_KEY",
  policy: {
    allowedTemplates: ["openai/chat"],
    maxUses: 100,
  },
  usesRemaining: 100,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP,
};

// Session-scoped secret fixture (7B-4B Task 10)
export const STUB_SESSION_SECRET_1: SessionSecretWire = {
  id: STUB_SESSION_SECRET_ID,
  sessionId: STUB_SESSION_ID,
  label: "DB_PASSWORD",
  handle: "db-password",
  transport: "template" as const,
  status: "active" as const,
  provider: "bob" as const,
  policy: {},
  projectId: null,
  workspaceId: null,
  externalRef: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP,
};

// Name that the `secrets.create` stub treats as a conflict demo, so client
// code can exercise the error channel end-to-end.
export const STUB_CONFLICT_NAME = "CONFLICT_DEMO";

const knownIds = new Set<string>([STUB_SECRET_ID_1, STUB_SECRET_ID_2]);

// --- Raw handlers object (also exported for direct unit tests) ---

export const stubSecretsHandlers = {
  // --- Tenant-scoped (original 6) ---

  "secrets.create": ({
    name,
  }: {
    readonly name: string;
    readonly plaintext: string;
  }) => {
    if (name === STUB_CONFLICT_NAME) {
      return Effect.fail(
        new SecretNameConflictError({ tenantId: STUB_TENANT_ID, name }),
      );
    }
    const envelope: SecretEnvelopeWire = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      tenantId: STUB_TENANT_ID,
      name,
      policy: {},
      usesRemaining: null,
      createdAt: STUB_TIMESTAMP,
      updatedAt: STUB_TIMESTAMP,
    };
    return Effect.succeed(envelope);
  },

  "secrets.list": () =>
    Effect.succeed<readonly SecretEnvelopeWire[]>([
      STUB_SECRET_ENVELOPE_1,
      STUB_SECRET_ENVELOPE_2,
    ]),

  "secrets.getEnvelope": ({ secretId }: { readonly secretId: string }) => {
    if (secretId === STUB_SECRET_ID_1) return Effect.succeed(STUB_SECRET_ENVELOPE_1);
    if (secretId === STUB_SECRET_ID_2) return Effect.succeed(STUB_SECRET_ENVELOPE_2);
    return Effect.fail(
      new SecretNotFoundError({ secretId, tenantId: STUB_TENANT_ID }),
    );
  },

  "secrets.decryptForUse": ({ secretId }: { readonly secretId: string }) => {
    if (secretId === STUB_SECRET_ID_1) {
      return Effect.succeed({
        plaintext: "stub-plaintext-value-1",
        envelope: STUB_SECRET_ENVELOPE_1,
      });
    }
    if (secretId === STUB_SECRET_ID_2) {
      return Effect.succeed({
        plaintext: "stub-plaintext-value-2",
        envelope: STUB_SECRET_ENVELOPE_2,
      });
    }
    return Effect.fail(
      new SecretNotFoundError({ secretId, tenantId: STUB_TENANT_ID }),
    );
  },

  "secrets.markUsed": ({ secretId }: { readonly secretId: string }) => {
    if (knownIds.has(secretId)) return Effect.void;
    return Effect.fail(
      new SecretNotFoundError({ secretId, tenantId: STUB_TENANT_ID }),
    );
  },

  "secrets.delete": ({ secretId }: { readonly secretId: string }) => {
    if (knownIds.has(secretId)) return Effect.void;
    return Effect.fail(
      new SecretNotFoundError({ secretId, tenantId: STUB_TENANT_ID }),
    );
  },

  // --- Session-scoped (7B-4B Task 10) ---

  "secrets.session.getManifest": ({
    sessionId,
  }: {
    readonly sessionId: string;
  }) => {
    if (sessionId === STUB_SESSION_ID) {
      return Effect.succeed<readonly SessionSecretWire[]>([
        STUB_SESSION_SECRET_1,
      ]);
    }
    return Effect.fail(
      new NotFoundError({ entity: "Session", id: sessionId }),
    );
  },

  "secrets.session.getForExecution": ({
    sessionId,
    handle,
  }: {
    readonly sessionId: string;
    readonly handle: string;
  }) => {
    if (sessionId === STUB_SESSION_ID && handle === "db-password") {
      const result: SessionSecretForExecutionWire = {
        ...STUB_SESSION_SECRET_1,
        usageCount: 0,
        value: "stub-session-secret-value",
      };
      return Effect.succeed(result);
    }
    return Effect.fail(
      new NotFoundError({ entity: "SessionSecret", id: `${sessionId}/${handle}` }),
    );
  },

  "secrets.session.create": ({
    sessionId,
    label,
    handle,
  }: {
    readonly sessionId: string;
    readonly label: string;
    readonly handle: string;
    readonly value: string;
  }) => {
    const created: SessionSecretWire = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sessionId,
      label,
      handle,
      transport: "template" as const,
      status: "active" as const,
      provider: "bob" as const,
      policy: {},
      projectId: null,
      workspaceId: null,
      externalRef: null,
      createdAt: STUB_TIMESTAMP,
      updatedAt: STUB_TIMESTAMP,
    };
    return Effect.succeed(created);
  },

  "secrets.session.list": ({
    sessionId,
  }: {
    readonly sessionId: string;
  }) => {
    if (sessionId === STUB_SESSION_ID) {
      return Effect.succeed<readonly SessionSecretWire[]>([
        STUB_SESSION_SECRET_1,
      ]);
    }
    return Effect.fail(
      new NotFoundError({ entity: "Session", id: sessionId }),
    );
  },

  "secrets.session.delete": ({
    secretId,
  }: {
    readonly secretId: string;
  }) => {
    if (secretId === STUB_SESSION_SECRET_ID) {
      const result: SessionSecretDeleteResultWire = { deleted: 1 };
      return Effect.succeed(result);
    }
    return Effect.fail(
      new SecretNotFoundError({ secretId, tenantId: STUB_TENANT_ID }),
    );
  },

  "secrets.session.markUsed": ({
    secretId,
    sessionId,
    executor,
    templateId,
    commandPreview,
    exitCode,
    durationMs,
  }: {
    readonly secretId: string;
    readonly sessionId: string;
    readonly executor: string;
    readonly templateId?: string;
    readonly commandPreview?: string;
    readonly exitCode?: number;
    readonly durationMs?: number;
  }) => {
    const usage: SessionSecretUsageWire = {
      secretId,
      sessionId,
      executor,
      templateId,
      commandPreview,
      exitCode,
      durationMs,
    };
    return Effect.succeed(usage);
  },

  "secrets.session.upsertDeployBinding": ({
    projectId,
    environment,
    label,
    forgegraphKey,
    externalRef,
    transport,
    templateId,
  }: {
    readonly projectId: string;
    readonly environment: string;
    readonly label: string;
    readonly forgegraphKey: string;
    readonly externalRef: string;
    readonly transport?: string;
    readonly templateId?: string;
  }) => {
    if (projectId === STUB_PROJECT_ID) {
      const binding: ProjectDeployBindingWire = {
        projectId,
        environment: environment as ProjectDeployBindingWire["environment"],
        label,
        forgegraphKey,
        externalRef,
        transport: (transport ?? "template") as ProjectDeployBindingWire["transport"],
        templateId,
      };
      return Effect.succeed(binding);
    }
    return Effect.fail(
      new NotFoundError({ entity: "Project", id: projectId }),
    );
  },

  "secrets.session.promote": ({
    secretId,
  }: {
    readonly secretId: string;
    readonly projectId: string;
    readonly environment: string;
    readonly forgegraphKey: string;
  }) => {
    if (secretId === STUB_SESSION_SECRET_ID) {
      const promoted: SessionSecretWire = {
        ...STUB_SESSION_SECRET_1,
        status: "promoted" as const,
        provider: "forgegraph" as const,
        externalRef: "fg-ref-stub",
      };
      return Effect.succeed(promoted);
    }
    return Effect.fail(
      new SecretNotFoundError({ secretId, tenantId: STUB_TENANT_ID }),
    );
  },
};

// --- Layer form for RpcServer mounting ---
//
// `RpcGroup.toLayer` accepts a handlers-shape object (effect@4.0.0-beta.43
// RpcGroup.d.ts:50). Consumers mount via `Layer.provide(layerStubSecretsHandlers)`
// when composing `RpcServer.layerHttp`.
export const layerStubSecretsHandlers = SecretsRpc.toLayer(stubSecretsHandlers);

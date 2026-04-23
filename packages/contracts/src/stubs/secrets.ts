// Deterministic in-memory stubs for the SecretsRpc contract group. Lets OODA
// (and any other client) wire up typed calls against a fixed mock surface
// before real service handlers land in 6J. All IDs and timestamps are pinned
// so consumers can write golden-style tests.
import { Effect } from "effect";

import { SecretNameConflictError, SecretNotFoundError } from "@gmacko/secrets";

import { SecretsRpc } from "../groups/secrets.js";
import type { SecretEnvelopeWire } from "../schemas/secrets.js";

// --- Fixtures ---

// Valid v4-shaped UUIDs so the SecretEnvelope schema's `isUUID` check passes.
// The version nibble (position 14) is `4` and the variant nibble (position 19)
// is one of `8/9/a/b`.
export const STUB_TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const STUB_SECRET_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STUB_SECRET_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

// Name that the `secrets.create` stub treats as a conflict demo, so client
// code can exercise the error channel end-to-end.
export const STUB_CONFLICT_NAME = "CONFLICT_DEMO";

const knownIds = new Set<string>([STUB_SECRET_ID_1, STUB_SECRET_ID_2]);

// --- Raw handlers object (also exported for direct unit tests) ---

export const stubSecretsHandlers = {
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
};

// --- Layer form for RpcServer mounting ---
//
// `RpcGroup.toLayer` accepts a handlers-shape object (effect@4.0.0-beta.43
// RpcGroup.d.ts:50). Consumers mount via `Layer.provide(layerStubSecretsHandlers)`
// when composing `RpcServer.layerHttp`.
export const layerStubSecretsHandlers = SecretsRpc.toLayer(stubSecretsHandlers);

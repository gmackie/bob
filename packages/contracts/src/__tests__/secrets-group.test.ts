import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  SecretsCreateRpc,
  SecretsDecryptForUseRpc,
  SecretsDeleteRpc,
  SecretsGetEnvelopeRpc,
  SecretsListRpc,
  SecretsMarkUsedRpc,
  SecretsRpc,
} from "../groups/secrets.js";
import { SecretEnvelopeSchema } from "../schemas/secrets.js";
import {
  STUB_SECRET_ID_1,
  stubSecretsHandlers,
} from "../stubs/secrets.js";

describe("SecretsRpc", () => {
  it("resolves the 6 declared secret procedures by tag", () => {
    const expectedTags = [
      "secrets.create",
      "secrets.list",
      "secrets.getEnvelope",
      "secrets.decryptForUse",
      "secrets.markUsed",
      "secrets.delete",
    ];

    expect(SecretsCreateRpc._tag).toBe("secrets.create");
    expect(SecretsListRpc._tag).toBe("secrets.list");
    expect(SecretsGetEnvelopeRpc._tag).toBe("secrets.getEnvelope");
    expect(SecretsDecryptForUseRpc._tag).toBe("secrets.decryptForUse");
    expect(SecretsMarkUsedRpc._tag).toBe("secrets.markUsed");
    expect(SecretsDeleteRpc._tag).toBe("secrets.delete");

    const requests = SecretsRpc.requests as Map<string, unknown>;
    for (const tag of expectedTags) {
      expect(requests.has(tag)).toBe(true);
    }
    expect(requests.size).toBe(expectedTags.length);
  });

  it("stub handler for secrets.list returns two envelopes matching the schema", async () => {
    const envelopes = await Effect.runPromise(
      stubSecretsHandlers["secrets.list"]() as Effect.Effect<
        readonly unknown[],
        never,
        never
      >,
    );
    expect(envelopes.length).toBe(2);
    for (const env of envelopes) {
      // Structural validation against the declared success schema
      Schema.decodeUnknownSync(SecretEnvelopeSchema)(env);
    }
  });

  it("stub handler for secrets.getEnvelope fails with SecretNotFoundError for unknown id", async () => {
    const unknownId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const exit = await Effect.runPromiseExit(
      stubSecretsHandlers["secrets.getEnvelope"]({ secretId: unknownId }) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const rendered = JSON.stringify(exit.cause);
      expect(rendered).toContain("SecretNotFoundError");
      expect(rendered).toContain(unknownId);
    }

    // Happy path sanity: known id resolves and the envelope decodes cleanly
    const ok = await Effect.runPromise(
      stubSecretsHandlers["secrets.getEnvelope"]({ secretId: STUB_SECRET_ID_1 }) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    );
    Schema.decodeUnknownSync(SecretEnvelopeSchema)(ok);
  });
});

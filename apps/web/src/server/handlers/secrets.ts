import "server-only";
import { Effect } from "effect";

import { SecretsRpc } from "@gmacko/contracts/groups/secrets";
import { CurrentUser } from "@gmacko/rpc/context";
import { AuthMiddleware } from "@gmacko/core/auth";
import { Secrets } from "@gmacko/core/secrets";
import type { SessionSecretId } from "@gmacko/core/validators";

// Real handlers for SecretsRpc — replaces the deterministic stubs from
// `@gmacko/contracts/stubs/secrets`. Tenant scope is read from CurrentUser
// (populated by AuthMiddleware).
//
// `secrets.decryptForUse` is the only path that returns plaintext; the
// service-side policy + usage-counter checks run inside the service.
//
// `args` arrives as a `readonly string[] | undefined` on the wire. The
// service typing expects `readonly string[] | undefined` directly so we
// pass-through. Likewise `policy` and `usesRemaining`.

export const secretsHandlerMap = SecretsRpc.middleware(AuthMiddleware).of({
  "secrets.create": ({ name, plaintext, policy, usesRemaining }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const secrets = yield* Secrets.asEffect();
      // Wire policy is `readonly` (Schema-decoded shape); the service's
      // `SessionSecretPolicy` is mutable. Clone arrays/records so we drop
      // the `readonly` brand without mutating in place.
      const policyMut = policy
        ? {
            allowedTemplates: policy.allowedTemplates
              ? [...policy.allowedTemplates]
              : undefined,
            allowedArgPrefixes: policy.allowedArgPrefixes
              ? Object.fromEntries(
                  Object.entries(policy.allowedArgPrefixes).map(([k, v]) => [
                    k,
                    [...v],
                  ]),
                )
              : undefined,
            maxUses: policy.maxUses,
            redactOutput: policy.redactOutput,
          }
        : undefined;
      const envelope = yield* secrets.createSecret({
        tenantId: user.tenantId,
        name,
        plaintext,
        policy: policyMut,
        usesRemaining: usesRemaining ?? null,
      });
      return {
        id: envelope.id as string,
        tenantId: envelope.tenantId as string,
        name: envelope.name,
        policy: envelope.policy,
        usesRemaining: envelope.usesRemaining,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
      };
    }),

  "secrets.list": () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const secrets = yield* Secrets.asEffect();
      const list = yield* secrets.listForTenant(user.tenantId);
      return list.map((envelope) => ({
        id: envelope.id as string,
        tenantId: envelope.tenantId as string,
        name: envelope.name,
        policy: envelope.policy,
        usesRemaining: envelope.usesRemaining,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
      }));
    }),

  "secrets.getEnvelope": ({ secretId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const secrets = yield* Secrets.asEffect();
      const envelope = yield* secrets.getSecret({
        secretId: secretId as SessionSecretId,
        tenantId: user.tenantId,
      });
      return {
        id: envelope.id as string,
        tenantId: envelope.tenantId as string,
        name: envelope.name,
        policy: envelope.policy,
        usesRemaining: envelope.usesRemaining,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
      };
    }),

  "secrets.decryptForUse": ({ secretId, templateId, args }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const secrets = yield* Secrets.asEffect();
      const result = yield* secrets.decryptForUse({
        secretId: secretId as SessionSecretId,
        tenantId: user.tenantId,
        templateId,
        args,
      });
      return {
        plaintext: result.plaintext,
        envelope: {
          id: result.envelope.id as string,
          tenantId: result.envelope.tenantId as string,
          name: result.envelope.name,
          policy: result.envelope.policy,
          usesRemaining: result.envelope.usesRemaining,
          createdAt: result.envelope.createdAt,
          updatedAt: result.envelope.updatedAt,
        },
      };
    }),

  "secrets.markUsed": ({ secretId, templateId, commandPrefix, success }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const secrets = yield* Secrets.asEffect();
      yield* secrets.markSecretUsed({
        secretId: secretId as SessionSecretId,
        tenantId: user.tenantId,
        templateId,
        commandPrefix,
        success,
      });
    }),

  "secrets.delete": ({ secretId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const secrets = yield* Secrets.asEffect();
      yield* secrets.deleteSecret({
        secretId: secretId as SessionSecretId,
        tenantId: user.tenantId,
      });
    }),
});

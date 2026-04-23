// Secrets facade for @gmacko/client. Mirrors SecretsRpc — 6 procedures.
//
// `decryptForUse` is the only procedure that returns plaintext (never cache
// it — OODA should consume the plaintext exactly once and discard). The
// policy object, envelope metadata, and usage bookkeeping travel alongside.

import { Effect } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { SecretsRpc } from "@gmacko/contracts/groups/secrets";
import type {
  SecretEnvelopeWire,
  SessionSecretPolicyWire,
} from "@gmacko/contracts/schemas/secrets";

import type { ClientRuntime } from "./internal/runtime.js";

export interface SecretsClient {
  readonly create: (input: {
    readonly name: string;
    readonly plaintext: string;
    readonly policy?: SessionSecretPolicyWire | undefined;
    readonly usesRemaining?: number | null | undefined;
  }) => Promise<SecretEnvelopeWire>;
  readonly list: () => Promise<ReadonlyArray<SecretEnvelopeWire>>;
  readonly getEnvelope: (input: {
    readonly secretId: string;
  }) => Promise<SecretEnvelopeWire>;
  readonly decryptForUse: (input: {
    readonly secretId: string;
    readonly templateId?: string | undefined;
    readonly args?: ReadonlyArray<string> | undefined;
  }) => Promise<{
    readonly plaintext: string;
    readonly envelope: SecretEnvelopeWire;
  }>;
  readonly markUsed: (input: {
    readonly secretId: string;
    readonly templateId?: string | undefined;
    readonly commandPrefix?: string | undefined;
    readonly success?: boolean | undefined;
  }) => Promise<void>;
  readonly delete: (input: {
    readonly secretId: string;
  }) => Promise<void>;
}

type AnyRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Effect.Effect<unknown, unknown, unknown>;
type OpaqueClient = Record<string, AnyRpcFn>;

export const makeSecretsClient = (runtime: ClientRuntime): SecretsClient => {
  const invoke = <A>(tag: string, payload?: unknown): Promise<A> =>
    runtime.runEffect(
      Effect.flatMap(RpcClient.make(SecretsRpc), (client) => {
        const fn = (client as unknown as OpaqueClient)[tag]!;
        return fn(payload) as Effect.Effect<A, unknown, never>;
      }) as Effect.Effect<A, unknown, never>,
    );

  return {
    create: (input) => invoke<SecretEnvelopeWire>("secrets.create", input),
    list: () => invoke<ReadonlyArray<SecretEnvelopeWire>>("secrets.list"),
    getEnvelope: (input) =>
      invoke<SecretEnvelopeWire>("secrets.getEnvelope", input),
    decryptForUse: (input) =>
      invoke<{
        readonly plaintext: string;
        readonly envelope: SecretEnvelopeWire;
      }>("secrets.decryptForUse", input),
    markUsed: (input) => invoke<void>("secrets.markUsed", input),
    delete: (input) => invoke<void>("secrets.delete", input),
  };
};

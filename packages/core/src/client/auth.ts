// Auth facade for @gmacko/client — Promise-shaped wrapper around AuthRpc.
//
// Each method maps 1:1 to a procedure in `packages/contracts/src/groups/auth.ts`.
// Wire-level types come from `@gmacko/contracts/schemas/auth`; error classes
// (TenantNotSelectedError, InvalidApiKeyError, ...) from `@gmacko/auth`. When
// a procedure fails, the returned Promise rejects with the tagged error class
// or an `RpcClientError` for transport-level failures.

import { Effect } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";
import type {
  ApiKeyIssueResultWire,
  ApiKeyListItemWire,
  CurrentUserWire,
  DeviceCodePollResultWire,
  DeviceFlowStartResultWire,
  MembershipWire,
} from "@gmacko/core/contracts/schemas/auth";

import type { ClientRuntime } from "./internal/runtime.js";

export interface AuthClient {
  readonly whoAmI: () => Promise<CurrentUserWire>;
  readonly listMemberships: () => Promise<ReadonlyArray<MembershipWire>>;
  readonly resolveTenant: (input: {
    readonly tenantIdHint?: string | undefined;
  }) => Promise<MembershipWire>;
  readonly issueApiKey: (input: {
    readonly name: string;
    readonly permissions: ReadonlyArray<"read" | "write" | "admin">;
    readonly ttlMs?: number | undefined;
  }) => Promise<ApiKeyIssueResultWire>;
  readonly listApiKeys: () => Promise<ReadonlyArray<ApiKeyListItemWire>>;
  readonly revokeApiKey: (input: {
    readonly apiKeyId: string;
  }) => Promise<void>;
  readonly startDeviceFlow: () => Promise<DeviceFlowStartResultWire>;
  readonly pollDeviceCode: (input: {
    readonly deviceCode: string;
  }) => Promise<DeviceCodePollResultWire>;
  readonly approveDeviceCode: (input: {
    readonly userCode: string;
    readonly tenantId: string;
  }) => Promise<void>;
}

// The RpcClient typed surface is keyed by dotted tag; the value at each key
// is a function whose first arg is the payload. TypeScript's strict mode
// under `noUncheckedIndexedAccess` treats those dynamic lookups as possibly
// undefined, which they aren't — the group guarantees every tag. We untype
// the lookup here so the facade stays legible.
type AnyRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Effect.Effect<unknown, unknown, unknown>;
type OpaqueClient = Record<string, AnyRpcFn>;

/**
 * Build a Promise-flavored facade over the AuthRpc group bound to the given
 * runtime. Each method scopes a fresh RpcClient per call — the transport
 * layer is shared, so there's no per-call connection setup cost beyond what
 * the underlying `fetch` would incur.
 */
export const makeAuthClient = (runtime: ClientRuntime): AuthClient => {
  const invoke = <A>(tag: string, payload?: unknown): Promise<A> =>
    runtime.runEffect(
      Effect.flatMap(RpcClient.make(AuthRpc), (client) => {
        const fn = (client as unknown as OpaqueClient)[tag]!;
        return fn(payload) as Effect.Effect<A, unknown, never>;
      }) as Effect.Effect<A, unknown, never>,
    );

  return {
    whoAmI: () => invoke<CurrentUserWire>("auth.whoAmI"),
    listMemberships: () =>
      invoke<ReadonlyArray<MembershipWire>>("auth.listMemberships"),
    resolveTenant: (input) => invoke<MembershipWire>("auth.resolveTenant", input),
    issueApiKey: (input) =>
      invoke<ApiKeyIssueResultWire>("auth.issueApiKey", input),
    listApiKeys: () =>
      invoke<ReadonlyArray<ApiKeyListItemWire>>("auth.listApiKeys"),
    revokeApiKey: (input) => invoke<void>("auth.revokeApiKey", input),
    startDeviceFlow: () =>
      invoke<DeviceFlowStartResultWire>("auth.startDeviceFlow"),
    pollDeviceCode: (input) =>
      invoke<DeviceCodePollResultWire>("auth.pollDeviceCode", input),
    approveDeviceCode: (input) =>
      invoke<void>("auth.approveDeviceCode", input),
  };
};

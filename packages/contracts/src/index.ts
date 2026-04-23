export * from "./rpc";
export * from "./errors";
export * from "./schemas/thread";
export * from "./schemas/branch";
export * from "./schemas/message";
export * from "./schemas/wiki";
export * from "./schemas/exploration";

// --- Phase 6F: Auth ------------------------------------------------------
// Auth group — kept as a distinct export (NOT merged into GmackoRpcGroup).
// Rationale: one RpcGroup per service lets consumers tree-shake clients
// per-group (`@gmacko/client/auth` can import just `AuthRpc`).
export { AuthRpc } from "./groups/auth";
export {
  AuthWhoAmIRpc,
  AuthListMembershipsRpc,
  AuthResolveTenantRpc,
  AuthIssueApiKeyRpc,
  AuthListApiKeysRpc,
  AuthRevokeApiKeyRpc,
  AuthStartDeviceFlowRpc,
  AuthPollDeviceCodeRpc,
  AuthApproveDeviceCodeRpc,
} from "./groups/auth";
export { stubAuthHandlers } from "./stubs/auth";
export {
  CurrentUserSchema,
  MembershipSchema,
  ApiKeyListItemSchema,
  ApiKeyIssueResultSchema,
  DeviceCodePollResultSchema,
  DeviceFlowStartResultSchema,
} from "./schemas/auth";
export type {
  CurrentUserWire,
  MembershipWire,
  ApiKeyListItemWire,
  ApiKeyIssueResultWire,
  DeviceCodePollResultWire,
  DeviceFlowStartResultWire,
} from "./schemas/auth";

// --- Projects ------------------------------------------------------------
// Standalone RpcGroup (not merged into GmackoRpcGroup) to preserve the
// one-group-per-service tree-shaking story. Other 6F groups (auth,
// secrets, agent) land their own export blocks alongside this one.
export {
  ProjectsRpc,
  ProjectsCreateRpc,
  ProjectsListRpc,
  ProjectsGetBySlugRpc,
  ProjectsDeleteRpc,
} from "./groups/projects";
export {
  stubProjectsHandlers,
  stubProjectsHandlersLayer,
  STUB_PROJECT_1,
  STUB_PROJECT_2,
  STUB_TENANT_ID as STUB_PROJECTS_TENANT_ID,
} from "./stubs/projects";
export { ProjectSchema } from "./schemas/projects";
export type { ProjectWire } from "./schemas/projects";

// --- Secrets -------------------------------------------------------------
// Standalone RpcGroup. `secrets.decryptForUse` is the only plaintext-returning
// procedure — its error channel is a Schema.Union of SecretNotFoundError |
// PolicyDeniedError | MaxUsesExceededError (array-arg form, verified in
// effect@4.0.0-beta.43).
export {
  SecretsRpc,
  SecretsCreateRpc,
  SecretsListRpc,
  SecretsGetEnvelopeRpc,
  SecretsDecryptForUseRpc,
  SecretsMarkUsedRpc,
  SecretsDeleteRpc,
} from "./groups/secrets";
export {
  stubSecretsHandlers,
  layerStubSecretsHandlers,
  STUB_SECRET_ENVELOPE_1,
  STUB_SECRET_ENVELOPE_2,
  STUB_SECRET_ID_1,
  STUB_SECRET_ID_2,
  STUB_CONFLICT_NAME,
  STUB_TENANT_ID as STUB_SECRETS_TENANT_ID,
} from "./stubs/secrets";
export {
  SecretEnvelopeSchema,
  SessionSecretPolicySchema,
} from "./schemas/secrets";
export type {
  SecretEnvelopeWire,
  SessionSecretPolicyWire,
} from "./schemas/secrets";

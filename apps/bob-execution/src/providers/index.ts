/**
 * Provider health, credit, and interactive auth.
 *
 * Exported as a package subpath so the daemon that actually holds the gateway
 * connection can reuse them. On hetzner-bob that is ooda-runner, not this app —
 * keeping one implementation is what stops the runner, the health CLI, and the
 * UI from forming three different opinions about whether an agent is alive.
 *
 * Everything re-exported here depends only on Node builtins.
 */

export { probeCliProvider } from "./cli-provider.js";
export type { CommandResult, RunCommand } from "./cli-provider.js";
export { providerIds } from "./contract.js";
export type { ProviderHealthSnapshot, ProviderId } from "./contract.js";
export { CreditLatch, classifyRunFailure, redactDetail } from "./credit.js";
export type { CreditState, RunFailureKind, RunOutcome } from "./credit.js";
export { FileCreditStore, defaultCreditStatePath } from "./credit-store.js";
export type { CreditStore } from "./credit-store.js";
export { decideDispatch } from "./dispatch-gate.js";
export type { GateDecision, HealthLike } from "./dispatch-gate.js";
export { authDrivers, getAuthDriver } from "./auth-driver.js";
export type { AuthDriver } from "./auth-driver.js";
export { AuthSessionManager } from "./auth-session.js";
export type { AuthPrompt, AuthPty, AuthResult } from "./auth-session.js";

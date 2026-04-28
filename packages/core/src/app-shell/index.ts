// @gmacko/app-shell — auth UI + provider stack + layout primitive for gmacko apps.
//
// Public surface:
//   - <GmackoAppProviders> — bundled provider stack (theme + query + rpc + toast + currentUser)
//     plus each provider exported individually for advanced cases.
//   - Auth UI: <LoginForm>, <TenantPicker>, <DeviceFlowEntry>, <AuthedOnly>.
//   - Layout: <AppShell> (sidebar + header + content).
//   - Error handling: <EffectErrorBoundary>.
//   - Hooks: useRpcClient, useCurrentUser, useToast.

export { GmackoAppProviders } from "./providers.js";
export type { GmackoAppProvidersProps } from "./providers.js";

export { RpcClientProvider, useRpcClient } from "./rpc-client-provider.js";
export { CurrentUserProvider, useCurrentUser } from "./current-user-provider.js";
export { ToastProvider, useToast } from "./toast.js";
export type { Toast, ToastKind, ToastInput } from "./toast.js";

export { AuthedOnly } from "./authed-only.js";
export type { AuthedOnlyProps } from "./authed-only.js";

export { LoginForm } from "./login-form.js";
export type { LoginFormProps } from "./login-form.js";

export { TenantPicker } from "./tenant-picker.js";
export type { TenantPickerProps } from "./tenant-picker.js";

export { DeviceFlowEntry } from "./device-flow-entry.js";
export type { DeviceFlowEntryProps } from "./device-flow-entry.js";

export { AppShell } from "./app-shell.js";
export type { AppShellProps } from "./app-shell.js";

export { EffectErrorBoundary } from "./error-boundary.js";

/** Package version/phase sentinel — kept for the Task 1 smoke test. */
export const __gmackoAppShellPhase = "6j" as const;

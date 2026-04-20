// @gmacko/auth — better-auth wrapped as Effect services + tenancy RBAC.
// Real exports (BetterAuth, Sessions, ApiKeys, DeviceCodes, Tenancy,
// AuthMiddleware, client factories) land in Tasks 10-17 of Phase 6C.
// This barrel currently exports only a version sentinel so Task 8's
// smoke test can assert the package resolves through the workspace.
export const __gmackoAuthPhase = "6c" as const;

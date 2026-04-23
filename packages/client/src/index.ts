// @gmacko/client — typed client SDK for the gmacko RPC surface.
//
// Real exports (createGmackoRpcClient + per-group factories for auth/projects/
// secrets/agent) land in Task 8 of Phase 6F. This file currently carries only
// a version sentinel so the Task 7 smoke test can prove the package resolves.
export const __gmackoClientPhase = "6f" as const;

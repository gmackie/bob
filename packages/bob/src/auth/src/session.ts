// @bob/auth/session — RETIRED (Phase 7B-3 Task 4).
//
// `validateSessionToken()` queried Bob's old singular `session` table which no
// longer receives rows (the auth runtime creates sessions in gmacko's plural
// `sessions` table). The function has been deleted.
//
// Session validation now goes through:
//   1. `authInstance.api.getSession({ headers })` (cookie + bearer paths)
//   2. The Effect runtime's `Sessions.validateRequest()` / `Sessions.validateToken()`

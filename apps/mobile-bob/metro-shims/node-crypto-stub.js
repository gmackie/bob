// Metro/Hermes has no "node:crypto". This app never calls the ForgeGraph/
// webhook client (packages/bob-client's `external.ts`) that transitively
// pulls in @gmacko/bob/contracts' hermes-action.ts, which needs Node's
// createHash for a server/CLI-only content digest. This stub only needs to
// satisfy module resolution so Metro can bundle the graph — it throws if
// anything in the mobile app actually reaches it at runtime.
function unavailable() {
  throw new Error(
    "node:crypto is not available on-device — this code path (Hermes action " +
      "digests) is server/CLI-only and should not run inside the mobile app.",
  );
}

module.exports = {
  createHash: unavailable,
  randomBytes: unavailable,
  randomUUID: unavailable,
};

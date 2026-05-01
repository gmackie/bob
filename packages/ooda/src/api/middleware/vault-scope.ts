import {
  personalVaultFindingsInbox,
  personalVaultGraphEdges,
  personalVaultGraphNodes,
  personalVaultSources,
  personalVaultStandingInterests,
  researchVaultFindingsInbox,
  researchVaultGraphEdges,
  researchVaultGraphNodes,
  researchVaultSources,
  researchVaultStandingInterests,
} from "@gmacko/ooda/db/schema";

import { authedProcedure, publicProcedure, t } from "../trpc";

// Resolve the per-vault Drizzle table refs (exported with schema baked in
// by `pgSchema(...)` in packages/db/src/schema/vault-taxonomy.ts).
// Drizzle cannot switch a pgSchema() target at query time, so we branch
// on the input here and let the rest of the query reference the chosen
// object by identity.
function pickVaultTables(schema: "research_vault" | "personal_vault") {
  if (schema === "personal_vault") {
    return {
      sources: personalVaultSources,
      graphNode: personalVaultGraphNodes,
      graphEdge: personalVaultGraphEdges,
      findingsInbox: personalVaultFindingsInbox,
      standingInterest: personalVaultStandingInterests,
    };
  }
  return {
    sources: researchVaultSources,
    graphNode: researchVaultGraphNodes,
    graphEdge: researchVaultGraphEdges,
    findingsInbox: researchVaultFindingsInbox,
    standingInterest: researchVaultStandingInterests,
  };
}

export type VaultTables = ReturnType<typeof pickVaultTables>;

/**
 * Resolves the vault schema for buddy procedures and attaches it to
 * `ctx.vaultSchema` and `ctx.vaultTables`. Downstream procedures read
 * `ctx.vaultTables` for table references and `ctx.vaultSchema` for the
 * schema name, instead of resolving tables themselves.
 *
 * V1.5 scope: every thread maps to `research_vault`. The middleware still
 * peeks at `input.threadId` so that when personal-vault support lands, we
 * can look up a per-thread vault assignment (e.g. a future
 * `research_thread.vault_slug` column) without changing the procedure
 * signatures.
 *
 * TODO(personal-vault): dispatch on the thread's declared vault once the
 * personal vault goes live. Until then, buddy tools are research-only
 * (see `docs/plans/2026-04-19-academic-research-buddy-implementation-plan.md`
 * "Notes on scope control" — personal-vault threads are intentionally
 * walled off at this layer).
 */
export const withVaultScope = t.middleware(async ({ ctx, input, next }) => {
  // `input` is `unknown` at the middleware layer (it hasn't been through
  // the procedure's Zod schema yet). We read `threadId` defensively so
  // future branching has the value available; V1.5 ignores it.
  const threadId = (input as { threadId?: string } | undefined)?.threadId;
  void threadId;

  const vaultSchema = "research_vault" as const;
  return next({
    ctx: { ...ctx, vaultSchema, vaultTables: pickVaultTables(vaultSchema) },
  });
});

/**
 * Buddy-scoped procedure. Use instead of `publicProcedure` for any
 * procedure that needs to query a vault's tables — the resolved schema
 * lands on `ctx.vaultSchema`.
 */
export const vaultScopedProcedure = publicProcedure.use(withVaultScope);

/**
 * Authed vault-scoped procedure. Same resolution as
 * `vaultScopedProcedure`, but requires a valid session before the
 * vault resolution even runs. Use for write-side buddy mutations
 * (`inboxTriage`, `interestUpdate`, `interestDisable`, `kbPromoteRequest`)
 * so only authenticated users can mutate vault data.
 */
export const vaultScopedAuthedProcedure =
  authedProcedure.use(withVaultScope);

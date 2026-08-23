# The Bob / OODA product boundary

Bob and OODA are two products in one monorepo. They share a database, a
runner, a mobile app and a deployment pipeline. What keeps them separable is
not a second git remote — it is a package wall, enforced by
`scripts/verify-product-boundary.test.mjs` in CI.

## Who owns what

| Layer | Owns | Never contains |
|---|---|---|
| `packages/ooda` | Deliberation, memory, provenance, proposals, research, vault, oracle | Work items, runs, PRs, deploy stages |
| `packages/bob` | Work items, execution, runs, PRs, projects, ForgeGraph | Threads, conversations, memories, proposals |
| `packages/core` | Shared infrastructure: auth, db driver, storage, UI primitives, telemetry | Any domain noun from either product |
| `apps/*` | Composition — the only place the two products meet | — |

## The rule

```
packages/ooda/**  must not import  @bob/*
packages/bob/**   must not import  @gmacko/ooda
apps/**           may import both
```

There is **no allowlist**. The correct number of exceptions is zero, so a new
crossing is a design conversation rather than a config edit. When a leaf
package genuinely needs something from the other side, one of these is true:

1. **It is infrastructure, not domain.** Move it to `@gmacko/core`.
   Two modules exist for exactly this reason. `@gmacko/core/telemetry`: OODA's
   oracle emits embedding spans, the span helper lived in `@bob/telemetry`, and
   the fix was to move the helper rather than permit the import.
   `@gmacko/core/skillfleet-bridge`: both products emit workflow journal
   records, so the journal belongs to neither — it sits in core and each
   product tags its own `source`.
2. **It is a cross-product call.** Go through the versioned contracts in
   `@gmacko/ooda/contracts/v1` and the adapters in
   `@gmacko/ooda/src/integrations/`, which speak HTTP and receipts, not
   TypeScript imports.
3. **It is composition.** Do it in `apps/*`.

## Durable action crosses via proposals

Reading across products is a contract call. *Writing* across products is not:
a durable or externally-visible action — creating a work item, opening a PR,
writing to a vault, calling another system — is mediated by a **proposal**
with an immutable payload digest, a named owner, an expiry, a stated
consequence, a rollback, and single-use approval.

This is already the operating policy encoded in `docs/hermes/operating-policy.md`
and enforced by the proposal invariants in `packages/ooda/src/kernel/proposals.ts`.
Workers get scratch capabilities; they never get durable write capabilities
directly.

## Why a package wall and not two repos

The standalone `ooda` repo was archived on 2026-08-23 after its fold at
`packages/ooda` overtook it — see `docs/migrations/ooda-fold-parity.json` for
the parity evidence and `docs/plans/2026-08-23-ooda-repo-collapse.html` for
the reasoning. The competing proposal was to keep two repos with a published
contracts artifact and cross-repo CI. That buys the same guarantee this wall
buys, for six to eight weeks of work plus a permanent two-repo tax on every
shared change — and it fails at the next release rather than at the moment of
the bad import.

The wall is the cheap version of the same idea. Keep it at zero exceptions and
the two products stay separable; start granting exceptions and the fold
quietly becomes unsplittable.

## The `ooda` ForgeGraph app record is retired but NOT deleted

`forge app delete ooda` returns a server-side 500. The cause appears to be its
secret store: the record still holds **9 production secrets**, including
`OODA_RUNNER_SECRET`, `OODA_ORACLE_TOKEN`, and `BOB_API_URL` /
`BOB_WORKSPACE_ID` / `BOB_API_KEY` (the last three updated 2026-08-03).

Deleting the record would take those secrets with it. Nothing reads them at
runtime — the runner gets its environment from `/opt/ooda-runner/.env` on the
node, per `EnvironmentFile` in `ooda-runner.service` — but that node-local file
is then the *only* copy. If the node were ever rebuilt, they would be
unrecoverable.

So the record is marked `RETIRED … DO NOT DEPLOY` in its description instead,
which achieves the safety goal (nobody mistakes it for live) without
destroying the credentials. Before anyone deletes it:

1. Export the 9 secrets, or confirm each is either dead or reproduced in the
   `bob` app's store. Note `bob/production` currently has none of the five
   OODA/BOB-integration keys above.
2. Then delete, and expect the 500 to need a server-side fix regardless.

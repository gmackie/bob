# The host daemon: two implementations, one recommendation

**Decision: keep Node for the server-side daemon, keep Go for the desktop one,
and stop treating that as a duplication to eliminate.** Revisit only if the
daemon ships to machines the team does not control.

## What exists

| | `apps/ooda-runner` (Node) | `bob-cli` (Go) |
|---|---|---|
| Deployment | systemd on the runner node | bundled inside the Electron app |
| Claims gateway sessions | ✅ `bob-gateway.ts` | ✅ |
| Runs OODA jobs, adapters, integrations | ✅ ~11k lines | ❌ |
| Ships to end users | ❌ | ✅ via `electron-builder` `extraResources` |
| Needs a Node runtime present | ✅ | ❌ single static binary |

`ooda-runner` replaced `bob-cli` **server-side** — the daemon on the runner node
claiming gateway sessions. It did not replace the desktop one:
`apps/desktop-bob/scripts/build-daemon.mjs` cross-compiles `github.com/blder/bob`
for five targets into `resources/bin/`, two darwin binaries are checked into git,
and `main.ts` spawns it at startup.

## Why not consolidate

The obvious tidying instinct is "two daemons is one too many." Both directions
cost more than they save:

**Rewrite the desktop daemon in Node.** Electron already ships a Node runtime, so
this is technically possible — but the daemon is spawned as a *separate process*
from the Electron main process, and packaging a second Node runtime plus its
`node_modules` into `extraResources` is substantially heavier than a ~10 MB static
binary. It also couples desktop packaging to the monorepo's install graph.

**Rewrite the server daemon in Go.** This is the expensive one. `ooda-runner` is
not a thin session claimer: it carries the Codex/Claude adapters, the OODA job
protocol, nine outbound integration clients, the supervisor's journal-then-send
durability, and the shared `@gmacko/core` and `@gmacko/ooda` contracts. Porting it
to Go means maintaining the session protocol, the adapter interface and the
contract types twice, in two languages, forever. The single-binary property buys
nothing on a host the team already controls and already runs Node on.

The duplication is real but shallow: it is the *session-claiming* role, not the
execution engine. Two deployment shapes with genuinely different constraints
justify two implementations of a small overlap.

## What would change the answer

If the daemon ever ships to machines the team does not control — a `blder.bot`
customer installing an agent runner on their own hardware — the calculus flips.
Then "no runtime dependency, one binary, one download" stops being a nicety and
becomes the product requirement, and consolidating *onto Go* is worth the
protocol-duplication cost.

That makes this decision downstream of the multi-tenancy question for
`apps/blder`, not an independent one. Until that is answered, the split stands.

## Consequence

- `bob-cli` is **not** archived, and its README says so.
- Neither daemon is the "legacy" one; they are peers with different jobs.
- A change to the gateway session protocol has to land in both. That cost is
  accepted deliberately — it is the price of the split, and it is small because
  the shared surface is small.

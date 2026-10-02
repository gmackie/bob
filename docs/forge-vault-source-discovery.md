# Forge migration source discovery — 2026-10-02

The best-supported personal-vault migration candidate is `gmackie/obsidian`,
with the canonical local checkout at `/Users/mackieg/obsidian`.
[The macOS integration-runner documentation](ooda/integration-only-runner-macos.md)
explicitly assigns that local data to the integration-only runner. This is a
rehearsal candidate, not confirmation that all writers currently use it.
The documented integration-only LaunchAgent was not installed in the inspected
user LaunchAgents directory.

Read-only Git metadata and allowlisted service configuration inspection found:

| Checkout | Reachable commits | Tracked files | Worktree changes | Observed HEAD |
| --- | ---: | ---: | ---: | --- |
| Mac `/Users/mackieg/obsidian` | 131 | 512 | 68 | `80fbbbed6ae07f6b88b7179c060409c8640eb5d6` |
| Bob host `/opt/obsidian` | 15 | 69 | 8 | `3104d3bafc5bc1e1d1456477fae77f90c9f75e85` |
| Bob host `/home/bob/hermes-workspace/obsidian` | 206 | 357 | 0 | `49a22a6f15e3ba10a41dd406ce3202601c8712dd` |

All three point at `github.com/gmackie/obsidian`. The Mac also has a `gitea`
remote at `git.gmac.io/gmackie/obsidian`. These are observed configuration
identities, not a decision to use GitHub Actions or change the Forgejo workflow.
No remotes were fetched; cached remote refs may be stale. Different HEADs alone
do not establish ancestry or divergence.

`hermes-vault-sync.service` uses the Hermes checkout and was failed at inspection.
The active `ooda-research-backend.service` process has
`RESEARCH_VAULT_PATH=/var/lib/ooda-research-backend/vault`, but that directory did
not exist on the host. It is a configured research destination, not an existing
history source. No personal/research vault configuration was found in the three
legacy Bob service environment files inspected.

Every existing checkout contains Git symlinks (mode `120000`). Forge's current
workspace materializer deliberately rejects symlinks. Archive preservation and
successful application materialization are separate requirements; a migration
cannot silently omit these objects or follow their targets.

The Mac and `/opt/obsidian` have local changes. A Git history archive alone would
not preserve those changes, untracked files, or ignored drafts. Counts were
observed while writers were unfenced and do not constitute a consistent backup.
An import boundary therefore cannot yet be described as “just clone origin.”
It must include retained refs from each checkout, private worktree snapshots,
ancestry reconciliation, and an explicit symlink policy. The existing history
archive/restore tool requires bare input and explicit handling of non-HEAD
symbolic refs and unreachable commits.

No note contents, credential values, source writes, import, writer fencing,
service changes, or production cutover were performed during discovery.
The disposable live pilot remains distinct from real-source import/rollback and
normal application-route qualification. The Forge evidence is retained in
`conformance/artifacts/bob-source-inventory-2026-10-02.json`.

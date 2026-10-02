# Opt-in Forge vault publication

`ForgePublicationStorage` implements Bob's existing `VersionedStoragePort` and can be injected into `VaultService`. The default remains `LocalGitStorage`. The trusted host binds tenant, actor, artifact, generation and repository identity, supplies authenticated Forge clients, and transfers prepared Git objects before publishing. A revision ID alone is not an upload.

Only an explicit Forge `accepted` result becomes a published receipt. A desired head observed during recovery remains indeterminate. Replaying an operation calls recovery only, never publication; identity or intent changes fail. Even replay of a terminal receipt reauthorizes through Forge. The local Bob journal records the application representation; Forge's durable journal remains authoritative. Raw transport errors are redacted.

The bridge retains Bob's local filesystem reads and working tree. It does not implement remote materialization, task forks, full ancestry, server-side merge, multi-ref transactions, or production configuration. Hosts authenticate access to local journal listing as well as every remote operation. Construction and testing alone do not activate a production backend.

Run the local composition from the Bob workspace:

```sh
FORGE_RUNTIME_ROOT=/path/to/built/forge node packages/ooda/scripts/verify-forge-vault.mjs
```

The runner uses the actual VaultService, bridge, Forge publisher, durable SQL journal and Git transport. For the live variant, run Forge's `scripts/qualify-artifact-publication.py --bob-root /path/to/bob` with its account, credential-file, state-dir and evidence arguments. Provisioning credentials stay outside the checkout; scoped runner credentials arrive on stdin. The harness creates and cleans disposable Cloudflare Artifacts and D1 resources.

`docs/evidence/forge-vault-live-2026-10-02.json` records the qualified source hashes, five live checks and zero remaining resources. It covers exact content, reconstructed adapter replay, lost acknowledgement, no resend and authorization revocation. This was a local Node host using live clouds, not a deployed Bob HTTP staging environment or production cutover. Before production adoption, deployed staging still needs history import and shadow-read checks, workspace/completion integration, runner-loss recovery, writer fencing and a rollback rehearsal that retains later writes.

The separate `forge-vault-http-host.ts` fixture adds an authenticated, bounded,
loopback HTTP boundary for write/read/replay testing. `FORGE_VAULT_HTTP=true`
selects it in the pilot. `build-forge-vault-pilot.mjs <built-forge-root> <output>`
bundles the actual Bob service/bridge and Forge runtime for a Node 24 host with
Git; it embeds no credentials and records a bundle digest. This is disposable
qualification tooling, not a new production route.

`docs/evidence/forge-vault-http-live-2026-10-02.json` records the pilot run on the
existing staging host in an isolated Node 24 container. The Forge harness verified
the deployed bundle digest before sending configuration over stdin. Five live
checks passed with two Git dispatches and no remaining cloud resources. HTTP
write and replay were exercised; normal Bob application route integration,
actual process-kill recovery and real-source migration remain separate gates.
Earlier direct-pilot evidence describes the source hashes from Bob PR #224;
new HTTP evidence describes the later pilot source.

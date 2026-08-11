# OODA integration-only runner on macOS

The macOS runner owns integrations whose canonical data is local to the Mac,
starting with `/Users/mackieg/obsidian`. It cannot claim agent jobs, host turns,
legacy runner sessions, or Bob gateway work. The Hetzner runner must keep
`OODA_OBSIDIAN_DELIVERY_ENABLED` unset or false.

## Release layout

Install immutable releases beneath:

```text
/Users/mackieg/.local/share/ooda-integration-runner/
  releases/<exact-bob-commit>/
  current -> releases/<exact-bob-commit>
```

Create the final release directory before installing dependencies. Do not move
an installed `node_modules` tree between release directories.

```sh
release_sha=<exact-merged-bob-commit>
release_root="$HOME/.local/share/ooda-integration-runner/releases/$release_sha"
git clone --filter=blob:none git@git.forgegraf.com:gmackie/bob.git "$release_root"
git -C "$release_root" checkout --detach "$release_sha"
pnpm --dir "$release_root" install --frozen-lockfile --filter @gmacko/ooda-runner...
chmod 700 "$release_root/apps/ooda-runner/ops/run-integration-only-macos.sh"
ln -sfn "$release_root" "$HOME/.local/share/ooda-integration-runner/current.next"
mv -h "$HOME/.local/share/ooda-integration-runner/current.next" \
  "$HOME/.local/share/ooda-integration-runner/current"
```

## Secret provisioning

Store the shared runner secret in the login keychain. Passing `-w` last causes
`security` to prompt, so the value does not enter shell history or process
arguments:

```sh
security add-generic-password -U \
  -a "$USER" \
  -s com.gmacko.ooda.integration-runner \
  -w
```

The launch wrapper reads the value directly from Keychain and exports it only
to the runner process. The plist contains no credential.

## Install and verify the LaunchAgent

```sh
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/OODA"
cp "$HOME/.local/share/ooda-integration-runner/current/apps/ooda-runner/ops/com.gmacko.ooda-integration-runner.plist" \
  "$HOME/Library/LaunchAgents/com.gmacko.ooda-integration-runner.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.gmacko.ooda-integration-runner.plist"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.gmacko.ooda-integration-runner.plist"
launchctl print "gui/$(id -u)/com.gmacko.ooda-integration-runner"
```

Before enabling an adapter, verify all of the following:

- The exact release commit is the reviewed Bob commit.
- The runner device advertises only `integration:<destination>` capabilities.
- The Obsidian proposal preview contains the exact path and content approved by
  the operator.
- The rollout stage enables that proposal kind for the owner.
- One approved canary delivery produces one receipt and one atomic vault write.

Rollback is immediate and does not remove data:

```sh
launchctl bootout "gui/$(id -u)/com.gmacko.ooda-integration-runner"
```

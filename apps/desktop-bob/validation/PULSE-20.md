# PULSE-20 validation

Repository: https://git.forgegraf.com/gmackie/bob

Authoritative default branch: `master`, verified using `git ls-remote --symref`
at `a5eb5226d9d478d3ed643aa6ee9ebc5d2feb1ed1` on 2026-10-30. The initial GitHub
checkout had unrelated history; this change starts from ForgeGraph's revision.

Inspection found the direct Electron/Node launch already implemented. This change
pins packaged runtime paths against inherited developer/previous-install overrides
and validates bundled launch code, built application assets, and migrations.
Packaging also isolates the already-bundled shell from the workspace manifest: the
original collector exhausted its 4 GiB heap enumerating the full pnpm graph.

## Checks

- `pnpm --filter @bob/server test`: 9 files, 31 tests passed, including a real
  loopback upstream launched with empty PATH from an installation path with spaces.
- `pnpm --filter @bob/desktop test`: 5 files, 20 tests passed, including portable
  dependency provenance. Test discovery excludes the copied `.node-app` sources.
- Server and desktop typechecks passed; both builds passed.
- `pnpm --filter @bob/desktop stage`: real Node app build and portable production
  dependency staging passed.
- `verify-bundled-startup.mjs` against staged resources with Electron 41.10.3:
  passed resource checksums, bundled service startup, proxy authentication, and
  the application auth/database endpoint with empty PATH and fresh HOME/data.
- Missing/corrupt launch file, Vinext CLI, migration, client asset and manifest
  tests assert the exact affected filename and reinstall guidance. The manifest
  remains valid after renaming an installation directory with spaces.

The first `pnpm test` run failed in `@bob/execution`'s real daemon lifecycle
condition; runner timing tests also failed before Turbo cancelled remaining
work. These files are outside this change. The serial `pnpm exec turbo run test --continue --concurrency=1` run completed:
21/24 tasks succeeded (9 cached). Execution and runner timing suites passed.
`@bob/api` and `@bob/db` failed global setup because emulator port 4000 did not
become ready after 180 seconds; `@gmacko/core-web` timed out its authenticated
database smoke test at 60 seconds. The project suite is not green.

Targeted Oxlint completed with warnings, including existing desktop supervisor
warnings and runtime JSON validation checks. `git diff --check` passed.

## Final package verification

The unsigned macOS arm64 app built successfully using the isolated shell project.
Its own `Contents/MacOS/Bob` launched final packaged resources at
`Bob Test Install.app/Contents/Resources` with empty PATH and fresh HOME/data.
Proxy authentication and the application auth/database endpoint passed. Renamed
the app to `Bob Updated Install.app` and repeated successfully, demonstrating
resolution from the current installation rather than the previous path.

Deleted then corrupted `blder/dist/server/index.js` in this disposable built app:
both checks reported the exact file and reinstall guidance. Restored the original
bytes and verified the complete manifest again. This exercises the same preflight
called by Electron before service startup; no GUI dialog claim is made.

## Remaining acceptance

Empty-PATH service checks isolate runtime executable resolution, but are not a
clean-machine GUI test. Signed/notarized installer launch on a clean machine/VM
without Node/pnpm, plus a real installer update, still requires release validation
using `PACKAGING.md`. No merge, publication or deployment is part of this task.
The issue remains open pending that evidence.

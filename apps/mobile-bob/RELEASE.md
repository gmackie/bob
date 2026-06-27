# Bob Mobile — Release / Build (Preflight)

Mobile builds use **Preflight** (local builds orchestrated by the control plane at
`preflight.forgegraf.com` + a local runner), **not** EAS cloud builds. The app is
production-wired against the live backend; this is the build/prove flow.

- Expo app: slug `bob`, owner `gmacko`, bundle `com.gmacko.bob`, scheme `bob://`
- Backend (production, `src/config/env.ts`): API+auth `https://bob.blder.bot`,
  OODA `https://ooda.blder.bot`, gateway `wss://ws.blder.bot` (hardcoded fallbacks,
  so it works even if an env var is unset)
- Auth: better-auth + `@better-auth/expo` (GitHub OAuth via `bob://` callback)
- Preflight binding: `apps/mobile-bob` → workspace `00000000-0000-4000-8000-000000000001`
  (already bound via `preflight config bind-workspace`)

## Status: Preflight-ready
`preflight prove-app --app-dir . --platform ios --local-readiness` → **`ready`**.
All checks pass (expo app/dev-client, scheme, bundle id, eas project/profile,
simulator profile, Maestro flow). The fix that unblocked it: the `development`
EAS profile is now a simulator profile (`ios.simulator: true`) — Preflight's
simulator lane resolves the `development` profile, matching the other repos'
convention. Device builds live under the `development:device` profile.

## EAS profiles (consumed by Preflight, built locally)
- `development` — dev-client, **simulator**, Debug, `localhost:3000` API
- `development:device` — same but on-device (`ios.simulator: false`)
- `beta` — staging (`${STAGING_API_URL}`), adhoc, channel `beta`
- `beta:production-api` — staging build pointed at prod `bob.blder.bot`
- `production` — `${PRODUCTION_API_URL}` (falls back to `bob.blder.bot`), channel `production`

## Build flow
From `apps/mobile-bob`:

```bash
# 1. (optional) re-check readiness
preflight prove-app --app-dir . --platform ios --local-readiness

# 2. Create + watch a source-bound proof workflow (simulator lane by default)
preflight prove-app --app-dir . --platform ios --lane simulator
#    --lane development  → on-device dev-client build
#    --priority N        → scheduling priority
#    --wait-for-runner   → queue even if no runner is online

# 3. On a Mac with Xcode, run a local runner to claim + build the job
preflight runner once --workspace-root /Volumes/dev/bob/bob
```

The runner does the actual local build (xcrun/simctl for iOS, gradle for Android)
and reports back to the control plane. A persistent runner can be deployed (see the
`preflight-runner` forge app) so jobs are claimed automatically.

## Credentials & providers (Preflight-owned)
Apple/Google/OAuth credentials are managed by Preflight, not wired into eas.json
secrets by hand:

```bash
preflight providers        # list/manage Apple + Google provider accounts
preflight credentials      # Preflight-owned credential references (signing, ASC keys)
preflight oauth-clients    # Google/Apple OAuth client records
preflight provider-readiness  # check what's blocking a provider
preflight setup            # guided setup for a blocked workflow
```

Attach a secret to runner jobs with `prove-app --secret-ref <id>`.

## Verify a build
- Install the simulator/dev build; sign in with GitHub (better-auth → `bob://`),
  confirming auth against `bob.blder.bot`.
- Confirm data loads (tasks/planning/runs) and live sessions connect to
  `wss://ws.blder.bot`.
- OTA after JS-only changes still uses EAS Update channels (`beta`/`production`),
  wired in `app.config.js`.

Source compiles clean (`pnpm typecheck`) and tests pass (`pnpm test`, 234).

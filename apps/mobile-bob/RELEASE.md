# Bob Mobile — Release Runbook

How to build and ship `apps/mobile-bob` (Expo) to TestFlight / Play. The app is
production-wired against the live backend; this is the credential-gated build +
submit that the repo can't run for you.

- Expo project: slug `bob`, id `e1dd0ab0-4dc1-40f8-b066-7cb91fde1759`, owner `gmacko`
- Bundle id / package: `com.gmacko.bob` · URL scheme: `bob://`
- Backend (production, from `src/config/env.ts`): API + auth `https://bob.blder.bot`,
  OODA `https://ooda.blder.bot`, gateway `wss://ws.blder.bot`.
  `env.ts` hardcodes these as fallbacks, so a missing `PRODUCTION_API_URL` still
  yields a working app.
- Auth: better-auth + `@better-auth/expo` (`bob://` OAuth callback, SecureStore).
  GitHub OAuth uses the same flow as the web; nothing extra to configure in-app.

## 0. Prerequisites
- `pnpm exec eas login` (as `gmacko`) — run from `apps/mobile-bob`.
- Apple: Apple Developer membership; an App Store Connect app for `com.gmacko.bob`
  (note its `ASC_APP_ID` and your `APPLE_ID` + `APPLE_TEAM_ID`).
- Android (only if shipping Play): a Play Console service-account JSON saved as
  `apps/mobile-bob/google-services.json` (referenced by `eas.json` submit config).

## 1. Set EAS env vars / secrets
`eas.json` references these `${...}` values. Set them as EAS environment variables
(`pnpm exec eas env:create --environment production --name <NAME> --value <VALUE>`,
add `--visibility secret` for credentials). Required vs optional:

| Var | Needed for | Required? |
|---|---|---|
| `PRODUCTION_API_URL` (= `https://bob.blder.bot`) | API/auth base | optional (env.ts falls back) |
| `STAGING_API_URL` (= `https://beta.blder.bot`) | staging/beta build | optional |
| `APPLE_ID`, `ASC_APP_ID`, `APPLE_TEAM_ID` | iOS `eas submit` | required for iOS submit |
| `EXPO_PUBLIC_SENTRY_DSN_PROD`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_MOBILE` | crash reporting + source maps | recommended |
| `EXPO_PUBLIC_POSTHOG_KEY_PROD`, `EXPO_PUBLIC_POSTHOG_HOST` | analytics | optional |

(`*_DEV` / `*_STAGING` variants only matter for those profiles.)

## 2. Build (cloud, ~10-20 min)
Test on the `beta` channel first, then production:

```bash
cd apps/mobile-bob
# staging/beta (internal testing)
pnpm exec eas build --profile beta --platform ios
# production
pnpm exec eas build --profile production --platform ios
# (swap --platform android, or use 'all', as needed)
```

`production` auto-increments the build number and publishes to the EAS Update
`production` channel; `beta` → `beta` channel. (`development` stays on the Expo
dev server — no EAS Updates — and `staging`/`beta` are hosted; this was fixed in
`app.config.js`'s `isHostedEnv`.)

## 3. Submit
```bash
cd apps/mobile-bob
pnpm exec eas submit --profile production --platform ios     # → TestFlight / App Store
pnpm exec eas submit --profile production --platform android  # → Play internal track
```

## 4. Verify
- Install the TestFlight/internal build on a device.
- Sign in with GitHub (better-auth → `bob://` callback) — confirms auth against
  `bob.blder.bot`.
- Confirm data loads (tasks/planning/runs) and live sessions connect to
  `wss://ws.blder.bot`.
- Check Sentry (mobile project) receives a test event.

## Notes
- Source compiles clean (`pnpm typecheck`) and tests pass (`pnpm test`, 234 tests).
- OTA updates: after a JS-only change, `pnpm exec eas update --channel production`
  pushes without a new store build (the `production`/`beta` channels are wired in
  `app.config.js`).

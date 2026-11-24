# OTA updates

Bob ships JavaScript and asset-only releases through Preflight's update server
(BOB-113). EAS Update is no longer used. OODA is part of Bob and ships through
the same binary and update channels.

- Manifest URL: `https://preflight.forgegraf.com/api/preflight/v1/ota/bob`
- Channels: `development`, `preview`, `production`. A build picks its channel
  from `APP_VARIANT` (`app.config.js`); the committed native projects send
  `production`, because store builds use them as they are.
- Signing: Preflight signs every manifest with Bob's `ota_code_signing_key` in
  its vault. `certs/ota-code-signing.pem` is the public certificate, and the
  committed `ios/BobDev/Supporting/Expo.plist` and `AndroidManifest.xml` carry
  the same one. A binary only accepts updates signed by the certificate it was
  built with, so rotating the key needs a new binary first.
- Runtime version: the literal `runtimeVersion` in `app.config.js` (currently
  `0.1.1-sdk58` for Expo SDK 58). An update reaches only binaries built with the same value. Native
  dependencies, config plugins, permissions, entitlements, bundle identifiers
  and other native inputs need a new binary and a new runtime version.

## Publish

```bash
pnpm update:development -- --workspace-root <clean checkout of the commit>
pnpm update:preview     -- --workspace-root <clean checkout of the commit>
pnpm update:production  -- --workspace-root <clean checkout of the commit>
```

Each queues `ota.export` and `ota.publish` on a Preflight runner, which exports
the checkout at `--workspace-root` as it is. Point it at a clean checkout of the
commit you mean to ship, on a host with a runner (for example labtop's
`/Volumes/dev-ssd/preflight-ci/bob-store`). The token comes from
`preflight login`.

Publish and verify on `development` first, then `preview`. Move the verified
update to production with Preflight's promote or republish API
(`POST /api/preflight/v1/ota/promote`, optional `rolloutPercent`), or roll back
with `POST /api/preflight/v1/apps/pfapp_bob/ota/rollback`.

Do not publish from a dirty working tree.

Binaries built before BOB-113 (TestFlight build 39 and earlier) still point at
EAS Update and never see Preflight updates.

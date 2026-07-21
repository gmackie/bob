# OTA updates

Bob uses EAS Update for JavaScript and asset-only releases. OODA is part of Bob
and ships through the same mobile binary and update channels.

The app uses Expo's `fingerprint` runtime policy. Native dependencies, config
plugins, permissions, entitlements, bundle identifiers, or other native inputs
require a new binary before publishing an update.

| Build profile                        | Channel           | EAS environment |
| ------------------------------------ | ----------------- | --------------- |
| `development` / `development:device` | `development`     | `development`   |
| `beta`                               | `beta`            | `preview`       |
| `beta:production-api`                | `beta-production` | `preview`       |
| `production`                         | `production`      | `production`    |

Publish and verify development first, then beta. Promote the exact verified
bundle to production with `eas update:republish`; if a fresh production export
is necessary, begin with `pnpm update:production:rollout -- --message "..."`.

Do not publish from a dirty working tree. Existing binaries using the previous
static `1.0.0` runtime need replacement before receiving fingerprinted updates.

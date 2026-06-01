# BizPulse Rebrand Rollout

Issue: GMA-22

## Name Lock-In

- User-visible product name: BizPulse
- Previous storefront name: Pulse Manager
- Legal entity / seller name: keep the current App Store Connect legal entity and developer account unchanged unless Legal or Finance explicitly approves an account-level change.
- Bundle IDs, schemes, package names, project IDs, and provisioning identifiers: unchanged for this rollout. These are release infrastructure identifiers, not user-facing brand surfaces.
- App Store product name target: BizPulse. Keep the name short enough for App Store Connect limits and do not append descriptors unless App Review requires disambiguation.
- iOS/Android installed display name target: BizPulse for production builds. Staging and development builds may keep environment suffixes.

## User-Visible Transition Plan

Use this copy for the release that introduces the storefront and installed-name transition:

Changelog / release notes:

> Pulse Manager is now BizPulse. The app, account, and data stay the same; only the name and storefront branding are changing.

In-app notice:

> Pulse Manager is now BizPulse. You do not need to migrate anything. Your existing workspace, settings, and saved data remain available.

Email notice, if an email campaign is sent:

Subject: Pulse Manager is now BizPulse

Body:

> We renamed Pulse Manager to BizPulse to match the product direction and storefront branding. Your account, subscription, workspace, and app data are unchanged. The next app update will show the BizPulse name in the store and on your device.

## Audit Checklist

Before release, search for lingering `Pulse Manager` references in:

- App Store Connect: app name, subtitle, description, promotional text, keywords, screenshots, preview captions, release notes, privacy nutrition labels, support URL pages.
- Google Play Console, if applicable: app title, short description, full description, release notes, graphics, screenshots, privacy/data safety text.
- Repository text: app config, fastlane metadata, README files, docs, localization files, tests, fixture data, screenshots, generated native projects.
- Marketing surfaces: website, landing pages, help center, blog posts, email templates, social profiles, press kit, launch assets.
- Product surfaces: in-app headers, onboarding, settings/about screens, push notifications, transactional emails.
- Operational dashboards: analytics project names, crash reporting, support macros, CRM records, billing product names, feature flag dashboards.
- External integrations: OAuth consent screens, webhook names, app icons, support inbox automations.

Suggested repo audit command:

```bash
rg -n "Pulse Manager|PulseManager|pulse manager|pulsemanager"
```

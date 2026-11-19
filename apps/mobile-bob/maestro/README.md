# Simulator flows

[Maestro](https://maestro.mobile.dev) flows that drive the built app on an iOS
simulator. They exist because unit tests cannot see a title falling back to a
route path, a label rendering at 1.17:1 against the background, or a tab that
lights up but refuses to navigate — every defect fixed in the commit that added
these was found by running the app, not by reading it.

Maestro drives the simulator directly. It does not move the host cursor, so
these are safe to run while you work.

## Running them

They need the app installed on a booted simulator and a server with data.

```sh
# 1. A database with a workspace's worth of content.
#    See packages/bob/src/db/src/seed-local.ts for what it writes and how.

# 2. The app, built for the simulator and pointed at that server.
pnpm --filter @bob/mobile ios

# 3. The flows.
maestro --device <udid> test apps/mobile-bob/maestro/01-tabs.yaml
maestro --device <udid> test apps/mobile-bob/maestro/ipad-02-navigation.yaml
```

`maestro hierarchy` prints the accessibility tree of whatever is on screen; it
is the fastest way to find the right selector when a flow cannot find an
element.

## Core conversation review (phone and iPad)

`core-flow.yaml` requires the OODA API, in addition to the Bob server used by
navigation and task screens. A reachable Bob server or WebSocket gateway alone
is insufficient. For local development, start OODA with
`pnpm --filter @gmacko/ooda-web dev` after configuring its database and auth.
Build/start the mobile app with `OODA_API_URL` pointing at that API. Development
otherwise defaults to `http://localhost:3001`; on a physical device use a host
reachable from the device. Setting Maestro's environment does **not** reconfigure
the installed app.

Sign in to a dedicated review account with `conversation_read` and
`conversation_write` rollout capabilities. Use the same account for preflight:

```sh
maestro --device <udid> test \
  -e OODA_API_URL="$OODA_API_URL" \
  -e OODA_AUTH_COOKIE="$OODA_AUTH_COOKIE" \
  apps/mobile-bob/maestro/core-flow.yaml
```

For dev auth bypass, supply `OODA_AUTH_TOKEN` instead of `OODA_AUTH_COOKIE`.
Keep credentials out of committed files and shared command logs. Preflight
checks rollout and authenticated conversation listing before launching the app;
an unavailable gateway, auth failure, or disabled rollout fails the run rather
than skipping Chat. The API must be reachable from both Maestro's host and the
simulator. UI readiness checks also catch app-side connectivity failures.

The flow preserves sign-in, opens Chat via the active shell, creates a thought
if necessary, and waits for the enabled voice composer. It resets microphone
permission to `unset` to exercise the iOS permission prompt, then checks a typed
draft without sending it. Use an English iOS simulator with speech recognition
available; enable Siri/dictation if required. Speech permission may also be
requested on devices without on-device recognition. Review runs may create an
empty conversation in the review account.

Run the preflight's isolated regression checks with
`node --test apps/mobile-bob/maestro/helpers/require-ooda.test.cjs`.

## What each covers

| Flow | Device | Covers |
|------|--------|--------|
| `core-flow.yaml` | both | OODA preflight, shell-aware Chat navigation, conversation readiness, microphone permission, and keyboard draft. |
| `00-dismiss-logbox.yaml` | both | Clears the dev-only LogBox toast that parks over the tab bar. Run it first from other flows. |
| `01-tabs.yaml` | phone | Every tab reaches its destination; More offers the overflow and nothing the tab bar already shows. |
| `02-titles-and-detail.yaml` | phone | Human titles on every screen; detail opens from a list; the active tab returns to its root. |
| `ipad-01-shell.yaml` | iPad | Dashboard operations counts and provider capacity. |
| `ipad-02-navigation.yaml` | iPad | Navigation overlay, outcome and queue lanes, mode switching. |
| `03-plan-create-run-watch.yaml` | phone and iPad | Create tasks, Run in Bob, then watch the run and return to the plan. Prepare it with `packages/bob/src/db/src/seed-plan-flow.ts` and `PLAN_FLOW_REPO` set to the repository Bob should run. |

## Selectors

Prefer `id:` selectors. Phone flows use the tab bar (`mobile-tab-home`,
`mobile-tab-tasks`, `mobile-tab-chat`, …). The iPad shell has different controls:
`tablet-mode-ooda`, `tablet-mode-planning`, `tablet-mode-tasks`,
`tablet-tab-conversations`, and `tablet-sidebar-settings`. Compact tablet layouts
first need `tablet-menu-button` to open the sidebar. An iPad in a narrow window
can render the phone shell, so choose selectors by visible shell, not device name.
`helpers/open-chat.yaml` handles these cases for core review runs. Do not run
phone-only navigation flows against the tablet sidebar.

Text
matching is a case-insensitive regex, so `assertNotVisible: "planning"` also
matches the title "Planning" — assert the title you expect instead of the one
you do not.

A tap that lands while the previous screen is still settling is swallowed.
After navigating, wait on something from the new screen (`extendedWaitUntil`)
before the next tap.

## Known dev-only noise

- `expo-notifications` fails to read its persisted registration in the
  simulator (no push entitlement), so LogBox shows an error toast over the tab
  bar. Real devices and TestFlight builds have the entitlement.
- The Expo dev-tools gear floats over the top-right, where the tablet's
  Settings control lives. Tapping there opens the dev menu instead.

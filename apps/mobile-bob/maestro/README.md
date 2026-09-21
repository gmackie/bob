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
#    See packages/bob/src/db/seed-local.ts for what it writes and how.

# 2. The app, built for the simulator and pointed at that server.
pnpm --filter @bob/mobile ios

# 3. The flows.
maestro --device <udid> test apps/mobile-bob/maestro/01-tabs.yaml
maestro --device <udid> test apps/mobile-bob/maestro/ipad-02-navigation.yaml
```

`maestro hierarchy` prints the accessibility tree of whatever is on screen; it
is the fastest way to find the right selector when a flow cannot find an
element.

## What each covers

| Flow | Device | Covers |
|------|--------|--------|
| `00-dismiss-logbox.yaml` | both | Clears the dev-only LogBox toast that parks over the tab bar. Run it first from other flows. |
| `01-tabs.yaml` | phone | Every tab reaches its destination; More offers the overflow and nothing the tab bar already shows. |
| `02-titles-and-detail.yaml` | phone | Human titles on every screen; detail opens from a list; the active tab returns to its root. |
| `ipad-01-shell.yaml` | iPad | Dashboard operations counts and provider capacity. |
| `ipad-02-navigation.yaml` | iPad | Navigation overlay, outcome and queue lanes, mode switching. |

## Selectors

Prefer `id:` on the tab bar (`mobile-tab-home`, `mobile-tab-tasks`, …). Text
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

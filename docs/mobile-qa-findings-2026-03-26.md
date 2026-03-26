# Mobile App QA Findings

**Date:** 2026-03-26
**Tester:** Claude Code (Maestro + visual inspection)
**Device:** iPhone 16 Pro Simulator (iOS 18.6)
**Build:** Fresh dev client via `expo prebuild --clean && expo run:ios`

## Maestro Test Results: 4/4 PASS

| Test | Status |
|------|--------|
| 01-app-launches | PASS |
| 02-onboarding-elements | PASS |
| 03-github-auth-attempt | PASS |
| 04-dark-theme | PASS |

## Issues Found

### ISSUE-001: Feature card text invisible on Sign-In screen (Critical)

**Symptom:** The three onboarding feature cards (🧱 Workspaces, 🤖 Task execution, 🔔 Single inbox) show card borders and emoji icons but ALL text is invisible. The "Welcome to Bob" title above the cards is also invisible.

**Scope:** All `Text` components using `className="text-foreground"` or `className="text-muted"` inside the `SignInScreen` component are not rendering visible text.

**Not affected:** The `Button` component's text ("Continue with GitHub") renders correctly using the same NativeWind classes.

**Root cause hypothesis:** NativeWind v5 with Tailwind v4 CSS variable-based colors (`--color-foreground: #e6edf3`) are not being resolved for `Text` components nested inside `View` containers. The `Button` component works because its `Text` is a direct child of `Pressable`, while the card text is nested 3-4 levels deep.

**Attempted fixes (none worked):**
- Changed `space-y-3` to `gap-3` — spacing improved but text still invisible
- Changed `flex-1` to `shrink` on text container — collapsed entirely
- Used inline `style={{ color: "#e6edf3", fontSize: 30 }}` — still invisible
- Full cache clear (`--clear`) + rebuild — same result
- `expo prebuild --clean` + full dev client rebuild — same result

**Suggested fix:** Replace NativeWind color classes with React Native `StyleSheet` inline colors for the sign-in screen, or investigate NativeWind v5 color variable resolution in nested components.

**File:** `apps/mobile/src/app/index.tsx` lines 93-162

### ISSUE-002: expo-web-browser error on GitHub auth (High)

**Symptom:** Tapping "Continue with GitHub" shows error toast: `Sign in error: Error: "expo-web-browser" is...` (truncated)

**Root cause:** The BetterAuth social sign-in flow calls `expo-web-browser` to open the OAuth URL, but the module fails at runtime. May need `expo install expo-web-browser` or it may not be compatible with the current dev client build.

**File:** `apps/mobile/src/app/index.tsx` line 82-89

### ISSUE-003: settings.getPreferences error toast before auth (Low)

**Symptom:** Red error toast shows on every screen: `settings.getPreferences UNAUTHORIZED`

**Root cause:** The settings query fires before the user is authenticated. Should be conditionally skipped when no session exists.

### ISSUE-004: No "Welcome to Bob" heading visible (Critical)

Same root cause as ISSUE-001. The heading `<Text className="text-foreground text-4xl font-semibold">Welcome to Bob</Text>` is invisible.

## Web vs Mobile Feature Gap

| Feature | Web | Mobile |
|---------|-----|--------|
| PR Management | ✅ List + Detail | ❌ Missing |
| Repository Browsing | ✅ Commits, PRs | ❌ Missing |
| System Status | ✅ Agents, deps | ❌ Missing |
| Split-view Planning | ✅ Dual panel | ❌ Missing |
| Batch Dispatch | ✅ | ❌ Missing |
| Planning Review | ✅ | ❌ Missing |
| Chat/Agent Page | ✅ | ❌ Missing |
| Database Management | ✅ | ❌ Missing |
| Planning Dashboard | ✅ | ✅ |
| Work Item Detail | ✅ | ✅ |
| Task Workspace | ✅ | ✅ |
| Project Detail | ✅ | ✅ |
| Notifications | ✅ | ✅ |
| Settings | ✅ | ✅ |

## Maestro Test Coverage Gaps

Current tests only cover:
- App launches
- Onboarding elements visible
- GitHub auth button triggers flow
- Dark theme rendering

**Not tested:**
- Post-auth navigation flows
- Planning dashboard data loading
- Work item detail interactions
- Task workspace execution
- Settings CRUD
- Error states and offline behavior

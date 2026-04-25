# Phase 6J — `@gmacko/app-shell`

Reusable web library: provider stack, auth UI primitives, layout shell, error boundary, toast. **Library only — no `apps/web` modifications.** OODA's existing app stays untouched; Bob/OODA wire `@gmacko/app-shell` into their own apps when they migrate.

## Scope

**In scope (locked):**
- **`@gmacko/app-shell` package** filled in (currently empty scaffold). Deps: `react@19`, `react-dom@19`, `@tanstack/react-query@^5.91.0`, `@gmacko/client` workspace, `@gmacko/ui` workspace, `effect@4.0.0-beta.43` (peerDependencies on react where appropriate).
- **`<GmackoAppProviders>` bundled provider** wraps `<ThemeProvider>` (from `@gmacko/ui`) → `<QueryClientProvider>` → `<RpcClientProvider>` → `<ToastProvider>` → `<CurrentUserProvider>` in dependency order. Each provider also exported individually for advanced cases.
- **`<RpcClientProvider>`** — instantiates `createGmackoRpcClient(opts)` once via `useState(() => createGmackoRpcClient(...))` and exposes via React context. `useRpcClient()` hook returns the client. SSR-safe (lazy instantiation).
- **`<CurrentUserProvider>`** — TanStack Query under the hood: `useQuery({queryKey: ["whoAmI"], queryFn: () => client.auth.whoAmI()})`. Exposes `useCurrentUser()` returning `{currentUser, isLoading, error, refetch}`. SSR returns loading skeleton.
- **`<AuthedOnly>`** wrapper: 3-state render — loading (configurable spinner), null (redirect via `redirectTo` prop, default `/login`), success (children). Uses `useCurrentUser()` internally. Redirect via Next.js `useRouter` if available, fallback to `window.location` setter.
- **`<LoginForm>`** presentational — email/password fields, GitHub OAuth button (links to `/api/auth/github`), "I have a code" CTA linking to `/login/device`. No actual auth state — caller wires `onSubmit` handlers. (Real auth flows are 6K's job; this is the UI shell.)
- **`<TenantPicker>`** — lists memberships via `useQuery({queryFn: () => client.auth.listMemberships()})`, renders a list of selectable tenants. On click, calls `client.auth.resolveTenant({tenantIdHint})` and refetches `whoAmI`. Used post-login when user has 2+ memberships.
- **`<DeviceFlowEntry>`** — single user-code input + submit. Calls `client.auth.approveDeviceCode({userCode, tenantId})`. Success/error states.
- **`<EffectErrorBoundary>`** — class component (React errror boundary). Catches errors during render. If `error._tag` is set (Effect tagged-error pattern), renders structured detail (`_tag` heading + payload key-value table). Otherwise plain message + reset button.
- **`<ToastProvider>` + `useToast()`** — context + portal. `toast({message, kind?: "info"|"success"|"warn"|"error"})`. Toasts render in a fixed-position container (bottom-right). Auto-dismiss after 5s. No external dep.
- **`<AppShell>`** layout primitive — sidebar + header + content slots via named props/children. Uses theme tokens for surfaces. SSR-safe (no client-only imports at module level).

**Deferred:**
- **Real auth flow wiring** (OAuth callback, session cookie management, redirect after login) — 6K's job.
- **Reference `apps/web` integration** — 6K wires the library into a real reference app.
- **Mobile / desktop login UI** — focus on web app shell only. Desktop/mobile have their own shells.
- **Accessibility audit** — basic semantic HTML + keyboard handlers; full a11y pass deferred.
- **i18n** — strings hardcoded English; `@gmacko/i18n` package is a deferred peripheral (6L).

## Exit criteria

- 33 packages (unchanged). `pnpm -r typecheck` green.
- Full test suite ≥ 325 passing (up from 314). Expected breakdown:
  - Baseline 6I: 314
  - Task 2 (ToastProvider): +3
  - Task 3 (EffectErrorBoundary): +3
  - Task 4 (RpcClientProvider): +2
  - Task 5 (CurrentUserProvider + useCurrentUser): +3
  - Task 6 (AuthedOnly): +3
  - Task 7 (LoginForm): +2
  - Task 8 (TenantPicker): +2
  - Task 9 (DeviceFlowEntry): +2
  - Task 10 (AppShell layout): +2
  - Task 11 (GmackoAppProviders bundle + barrel): +2
  - **Expected total: ~338** (well over 325).
- All components SSR-render without throwing in the test harness (rendered with `renderToString` or via React Testing Library's default jsdom).
- All client-only components carry `"use client"` directive.

## Design decisions (locked)

- **`"use client"` everywhere.** All `@gmacko/app-shell` components are interactive — none are RSC-friendly server components. Apps that want server components (RSC layouts) wrap their `app-shell` usage in `"use client"` boundaries themselves.
- **Library does NOT bundle React.** `react`/`react-dom` are `peerDependencies` (not `dependencies`); consumer apps provide their version. Same for `@tanstack/react-query`.
- **TanStack Query is NOT optional.** Built-in for `CurrentUserProvider`. Consumers either accept it or don't use the bundled provider stack (and DIY their own auth context).
- **CurrentUser via REST-like polling.** No subscription / SSE for auth state changes in 6J. `whoAmI` revalidates on focus / network reconnect (TanStack defaults). Works for typical session durations.
- **Tenant picker triggers `whoAmI` refetch.** After `resolveTenant` succeeds, invalidate the `["whoAmI"]` query — the new tenant id flows back through `useCurrentUser`.
- **Device flow CTA is a Link, not a route.** `<LoginForm>` doesn't know what route to send to; takes a `deviceFlowHref` prop (default `/login/device`). Consumer apps own routing.
- **Error boundary structured-payload rendering.** `_tag` is the heading; if `_schema` field exists (from `Schema.TaggedErrorClass`), iterate enumerable own properties for the payload table. Skip React-internal fields (`_schema`, etc).
- **Toast styling.** Uses `var(--color-bg-secondary)` + `var(--color-border)` + role-specific accents (success → success-color border, error → error-color border, etc). Theme-aware automatically.

## Effect 4 API additions

None — pure React + RPC client consumption. No Effect surface.

## Task breakdown

### Task 1: Scaffold `@gmacko/app-shell` deps + smoke test

`packages/app-shell/package.json`:
- `dependencies`: `@gmacko/client`, `@gmacko/ui` (workspace).
- `peerDependencies`: `react@^19.0.0`, `react-dom@^19.0.0`, `@tanstack/react-query@^5.91.0`.
- `devDependencies`: `@gmacko/tsconfig`, `@types/node`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/dom`, `vitest`, `jsdom`, `typescript`.
- `scripts`: `test`, `typecheck`.

vitest.config.ts: `environment: "jsdom"`, include `src/**/__tests__/**/*.test.tsx`.

`src/index.ts`: `export const __gmackoAppShellPhase = "6j" as const;`.

`src/__tests__/package.test.tsx`: smoke test asserting sentinel.

Commit: `chore(app-shell): scaffold deps for 6j`

### Task 2: `<ToastProvider>` + `useToast()`

`src/toast.tsx`:
```tsx
"use client";

interface Toast { id: string; message: string; kind?: "info"|"success"|"warn"|"error"; }
interface ToastContextValue {
  toast: (input: Omit<Toast, "id">) => void;
}

// Provider holds toast list in state; renders portal absolutely-positioned
// at bottom-right. Each toast auto-dismisses after 5s via setTimeout.
```

Tests — 3 cases:
1. `useToast().toast(...)` adds a toast that renders in the DOM.
2. Toasts auto-dismiss after 5s (use `vi.useFakeTimers()` + `vi.advanceTimersByTime`).
3. Multiple toasts render in order.

Commit: `feat(app-shell): add ToastProvider + useToast hook`

### Task 3: `<EffectErrorBoundary>`

`src/error-boundary.tsx` — React class component (functional error boundaries don't exist):

```tsx
class EffectErrorBoundary extends React.Component<...> {
  state = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    if (this.state.error) {
      const e = this.state.error as { _tag?: string; message?: string };
      // Render _tag + payload (if Effect tagged), else message
    }
    return this.props.children;
  }
}
```

Tests — 3 cases:
1. Catches throw of plain Error → renders `error.message`.
2. Catches throw of object with `_tag` → renders `_tag` heading + payload fields.
3. Reset button clears the error state.

Commit: `feat(app-shell): add EffectErrorBoundary`

### Task 4: `<RpcClientProvider>` + `useRpcClient()`

`src/rpc-client-provider.tsx`:
```tsx
"use client";
import { createContext, useContext, useState } from "react";
import { createGmackoRpcClient, type GmackoClientOptions } from "@gmacko/client";

const RpcClientContext = createContext<ReturnType<typeof createGmackoRpcClient> | null>(null);

export function RpcClientProvider({ children, options }: {
  children: React.ReactNode;
  options: GmackoClientOptions;
}) {
  const [client] = useState(() => createGmackoRpcClient(options));
  return <RpcClientContext.Provider value={client}>{children}</RpcClientContext.Provider>;
}

export function useRpcClient() {
  const ctx = useContext(RpcClientContext);
  if (!ctx) throw new Error("useRpcClient must be used within RpcClientProvider");
  return ctx;
}
```

Tests — 2 cases:
1. Provider mounts; `useRpcClient()` returns a client object with `.auth`/`.projects`/`.secrets`/`.agent`.
2. `useRpcClient()` outside provider throws.

Commit: `feat(app-shell): add RpcClientProvider`

### Task 5: `<CurrentUserProvider>` + `useCurrentUser()`

`src/current-user-provider.tsx`:
```tsx
"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRpcClient } from "./rpc-client-provider";

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;  // pass-through; the hook does the work
}

export function useCurrentUser() {
  const client = useRpcClient();
  return useQuery({
    queryKey: ["currentUser", "whoAmI"],
    queryFn: () => client.auth.whoAmI(),
    retry: false,
    staleTime: 30_000,
  });
}
```

(Provider is a pass-through because the query lives in the hook; React Query's QueryClient is the actual state owner. Keeping the Provider component for API symmetry.)

Tests — 3 cases:
1. `useCurrentUser()` calls `client.auth.whoAmI` and returns `{data}` after success.
2. Error case: returns `{error}`.
3. Loading state initially.

Use a mocked rpc client (`{auth: {whoAmI: vi.fn().mockResolvedValue({...})}}`) injected via `RpcClientProvider`.

Commit: `feat(app-shell): add CurrentUserProvider + useCurrentUser hook`

### Task 6: `<AuthedOnly>` wrapper

`src/authed-only.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { useCurrentUser } from "./current-user-provider";

export function AuthedOnly({
  children,
  fallback = <div>Loading...</div>,
  redirectTo = "/login",
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  redirectTo?: string;
}) {
  const { data, isLoading, error } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && (!data || error)) {
      // Redirect: try Next.js router first, fallback to window.location
      if (typeof window !== "undefined") {
        window.location.href = redirectTo;
      }
    }
  }, [data, isLoading, error, redirectTo]);

  if (isLoading) return <>{fallback}</>;
  if (!data || error) return <>{fallback}</>;  // brief render before redirect
  return <>{children}</>;
}
```

Tests — 3 cases:
1. Renders fallback while loading.
2. Renders children when authenticated.
3. Triggers redirect (assert `window.location.assign` mock called) when not authenticated.

Commit: `feat(app-shell): add AuthedOnly wrapper`

### Task 7: `<LoginForm>`

Presentational — email/password fields + GitHub OAuth link button + Device-flow CTA. Takes `onSubmit({email, password})`, `githubAuthHref`, `deviceFlowHref` props.

Tests — 2 cases:
1. Renders with all expected fields/buttons.
2. Submit button calls `onSubmit` with form values.

Commit: `feat(app-shell): add LoginForm component`

### Task 8: `<TenantPicker>`

Lists memberships via `useQuery({queryFn: client.auth.listMemberships})`. On click, calls `client.auth.resolveTenant({tenantIdHint})` then invalidates `["currentUser","whoAmI"]`. Loading/empty/error states.

Tests — 2 cases:
1. Renders memberships list.
2. Clicking a tenant calls `resolveTenant` with that tenantId.

Commit: `feat(app-shell): add TenantPicker component`

### Task 9: `<DeviceFlowEntry>`

User-code input + submit. Calls `client.auth.approveDeviceCode({userCode, tenantId})`. `tenantId` from `useCurrentUser()`. Success → toast + navigate (caller-provided `onSuccess` callback).

Tests — 2 cases:
1. Submitting calls `approveDeviceCode` with the entered code.
2. Success triggers `onSuccess` callback.

Commit: `feat(app-shell): add DeviceFlowEntry component`

### Task 10: `<AppShell>` layout primitive

`src/app-shell.tsx` — sidebar + header + content layout. Uses CSS grid. Theme tokens for surfaces.

```tsx
<AppShell sidebar={<Nav/>} header={<Header/>}>
  {/* main content */}
</AppShell>
```

Tests — 2 cases:
1. Renders all 3 slots when provided.
2. Renders without sidebar / header when omitted.

Commit: `feat(app-shell): add AppShell layout primitive`

### Task 11: `<GmackoAppProviders>` bundle + barrel + tests

`src/providers.tsx`:
```tsx
"use client";
import { ThemeProvider, type Theme, type Mode } from "@gmacko/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RpcClientProvider, type GmackoClientOptions } from "./rpc-client-provider";
import { ToastProvider } from "./toast";
import { CurrentUserProvider } from "./current-user-provider";

export function GmackoAppProviders({
  children,
  defaultTheme,
  defaultMode = "system",
  rpcOptions,
}: {
  children: React.ReactNode;
  defaultTheme: Theme;
  defaultMode?: Mode;
  rpcOptions: GmackoClientOptions;
}) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  }));
  return (
    <ThemeProvider defaultTheme={defaultTheme} defaultMode={defaultMode}>
      <QueryClientProvider client={queryClient}>
        <RpcClientProvider options={rpcOptions}>
          <ToastProvider>
            <CurrentUserProvider>{children}</CurrentUserProvider>
          </ToastProvider>
        </RpcClientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

Update `src/index.ts` with full re-export surface.

Tests — 2 cases:
1. Provider bundle mounts without errors with valid options.
2. Children can `useTheme`, `useRpcClient`, `useToast`, `useCurrentUser` simultaneously.

Commit: `feat(app-shell): add GmackoAppProviders bundle + finalize public barrel`

### Task 12: Exit verification + tag

1. `pnpm -r --filter '!./apps/*' typecheck` green.
2. Full test suite ≥ 325 passing. Serial for PGlite-heavy.
3. Git tree clean.
4. Tag `phase-6j-complete`.
5. Append "Phase 6J — Completed" section to this plan.
6. Merge to master + push tag.

---

## Open items carried into 6K onboarding

- **Real auth flow wiring** — OAuth callback handler, session cookie/header management, login redirect persistence.
- **Reference app integration** — 6K wires `@gmacko/app-shell` into a real Next.js test app to validate end-to-end.
- **Accessibility pass** — basic semantic HTML in 6J; full a11y audit (ARIA labels, keyboard navigation, screen reader testing) deferred.
- **i18n** — strings hardcoded English. `@gmacko/i18n` peripheral package handles strings later.
- **Error boundary recovery** — current pattern is reset-button only. Auto-recover on prop change is a polish.
- **Toast positioning + animation** — fixed bottom-right, no animation. Polish later.

## Convention reinforced

- Library packages: `peerDependencies` for runtime libs (react, query) so consumer-apps own the version.
- `"use client"` directive at the top of every interactive component.
- Auth UI components are presentational; auth state lives in `<CurrentUserProvider>`.
- Bundled providers + individual exports — consumers pick.

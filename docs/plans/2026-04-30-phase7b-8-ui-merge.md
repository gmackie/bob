# Phase 7B-8 — UI Merge (@bob/ui → @gmacko/core/ui)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Merge Bob's 17 Shadcn/Radix components into `@gmacko/core/ui`, unify the design token system, and rewire `apps/bob`'s 221 imports.

**Architecture:** Bob's Shadcn token convention (`--primary`, `--accent`, etc.) becomes canonical. Token values are scoped under `[data-theme="bob"]` / `[data-theme="ooda"]` selectors for multi-theme support. Bob's richer components replace gmacko's simpler equivalents. `@bob/ui` stays in-tree as reference but is no longer consumed.

**Tech Stack:** Tailwind CSS 4, Radix UI, class-variance-authority, sonner, clsx + tailwind-merge

---

## Task 1: Unify the theme CSS

**Files:**
- Modify: `tooling/tailwind/theme.css`
- Modify: `tooling/tailwind/package.json` (add dependencies if needed)

**Step 1: Rewrite `tooling/tailwind/theme.css`**

Merge Bob's Shadcn tokens (from `tooling/bob-tailwind/theme.css`) into gmacko's theme file, scoped under `[data-theme]` selectors. The file should:

1. Keep `@import "tailwindcss"` at the top
2. Keep the existing spacing/radius/font `@theme` block
3. Replace the `--color-*` custom property blocks with Shadcn-convention tokens
4. Scope Bob's `:root` tokens under `[data-theme="bob"]`
5. Scope Bob's `@variant dark` tokens under `[data-theme="bob"].dark`
6. Map OODA's existing tokens to Shadcn names under `[data-theme="ooda"]` and `[data-theme="ooda"].dark`
7. Add the `@theme inline` block that maps `--primary` → `--color-primary` etc. (from `tooling/bob-tailwind/theme.css` lines 101-159)
8. Add `@custom-variant dark (&:where(.dark, .dark *))` and similar for light/auto

The resulting structure:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));
@custom-variant light (&:where(.light, .light *));
@custom-variant auto (&:where(.auto, .auto *));

/* === BOB THEME (light) === */
[data-theme="bob"] {
  --background: oklch(0.9846 0.0031 108.25);
  --foreground: oklch(0.2221 0.0068 95.43);
  /* ... all Bob light tokens from tooling/bob-tailwind/theme.css lines 2-49 */
}

/* === BOB THEME (dark) === */
[data-theme="bob"].dark {
  --background: oklch(0.1867 0.0071 95.49);
  /* ... all Bob dark tokens from tooling/bob-tailwind/theme.css lines 52-98 */
}

/* === OODA THEME (light + dark placeholder) === */
[data-theme="ooda"],
[data-theme="ooda"].dark {
  /* Map existing OODA colors to Shadcn token names */
  --background: #111113;
  --foreground: #e8e4df;
  --primary: #d4a04a;
  --primary-foreground: #111113;
  --secondary: #222228;
  --secondary-foreground: #a09c97;
  --muted: #222228;
  --muted-foreground: #6b6863;
  --accent: #222228;
  --accent-foreground: #d4a04a;
  --destructive: #f87171;
  --destructive-foreground: #fff;
  --border: #2a2a2f;
  --input: #222228;
  --ring: #d4a04a;
  --card: #1a1a1f;
  --card-foreground: #e8e4df;
  --popover: #1a1a1f;
  --popover-foreground: #e8e4df;
  /* sidebar, chart, shadow, radius — copy from Bob dark */
}

@theme inline {
  /* ... the full @theme inline block from tooling/bob-tailwind/theme.css lines 101-159 */
}

@theme {
  --spacing-px: 1px;
  --space-2xs: 2px;
  /* ... keep existing spacing/font entries */
}
```

**Step 2: Verify nothing breaks**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run typecheck --concurrency=1
```

Expected: All packages typecheck (no CSS changes affect types).

**Step 3: Commit**

```bash
git add tooling/tailwind/theme.css
git commit -m "feat(tailwind): unify design tokens — Shadcn convention, data-theme scoped (7B-8 Task 1)"
```

---

## Task 2: Update ThemeProvider for Shadcn dark-class convention

**Files:**
- Modify: `packages/core/src/ui/theme-provider.tsx`

**Step 1: Update ThemeProvider to set `.dark`/`.light` classes**

The current ThemeProvider sets `data-theme` and `data-mode` attributes. Update it to ALSO set `.dark`/`.light` classes on `<html>` (needed by Shadcn's `@custom-variant dark`). Remove `data-mode` (replaced by classes).

```tsx
// In the useEffect that applies theme to <html>:
useEffect(() => {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // Shadcn dark-class convention
  root.classList.remove("light", "dark");
  root.classList.add(resolvedMode);
}, [theme, resolvedMode]);
```

Keep the existing `Theme` type (`"ooda" | "bob"`), `Mode` type (`"light" | "dark" | "system"`), and all the context/hooks unchanged.

**Step 2: Run core UI tests**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run test --filter=@gmacko/core --concurrency=1 -- --no-file-parallelism
```

Expected: All 458+ core tests pass. The theme-provider tests may need minor updates if they assert on `data-mode`.

**Step 3: Commit**

```bash
git add packages/core/src/ui/theme-provider.tsx
git commit -m "feat(ui): ThemeProvider sets .dark/.light class for Shadcn compat (7B-8 Task 2)"
```

---

## Task 3: Copy Bob's components into @gmacko/core/ui

**Files:**
- Create: `packages/core/src/ui/badge.tsx`
- Create: `packages/core/src/ui/card.tsx`
- Create: `packages/core/src/ui/dialog.tsx`
- Create: `packages/core/src/ui/dropdown-menu.tsx`
- Create: `packages/core/src/ui/error-boundary.tsx`
- Create: `packages/core/src/ui/field.tsx`
- Create: `packages/core/src/ui/inline-editable.tsx`
- Create: `packages/core/src/ui/label.tsx`
- Create: `packages/core/src/ui/select.tsx`
- Create: `packages/core/src/ui/separator.tsx`
- Create: `packages/core/src/ui/textarea.tsx`
- Create: `packages/core/src/ui/toast.tsx`
- Create: `packages/core/src/ui/tooltip.tsx`
- Modify: `packages/core/src/ui/button.tsx` (replace with Bob's version)
- Modify: `packages/core/src/ui/input.tsx` (replace with Bob's version)
- Modify: `packages/core/src/ui/utils.ts` (keep as-is, already compatible)

**Step 1: Copy each component from `packages/bob/src/ui/src/`**

For each component file, copy from Bob's UI package into `packages/core/src/ui/`. Change every `import { cn } from "@bob/ui"` to `import { cn } from "./utils"`. No other changes needed — the components use Tailwind semantic classes which will resolve via the unified theme.css.

For `button.tsx` and `input.tsx`: replace gmacko's existing versions with Bob's versions (they're richer — asChild, aria-invalid, data-slot, etc.).

For `toast.tsx`: it imports `useTheme` from `./theme` — update the import to use gmacko's ThemeProvider:
```tsx
import { useTheme } from "./theme-provider";
// Then in component: use `mode` instead of `themeMode`, map "system" → "system"
```

For `dialog.tsx`: has hardcoded `bg-[#0c1120]` — replace with `bg-popover` and `text-white` with `text-popover-foreground` for theme-awareness.

**Step 2: Add `radix-ui`, `sonner`, `class-variance-authority` to core's dependencies**

Check `packages/core/package.json` for missing deps. Bob's components need:
- `radix-ui` (Radix UI v2 unified package)
- `class-variance-authority`
- `sonner` (for toast)
- `@radix-ui/react-icons` (for dialog close, dropdown check/chevron, theme toggle icons)

```bash
cd /Volumes/dev/gmacko/packages/core && pnpm add radix-ui class-variance-authority sonner @radix-ui/react-icons
```

**Step 3: Commit**

```bash
git add packages/core/src/ui/ packages/core/package.json
git commit -m "feat(ui): add Bob's 15 Shadcn components to @gmacko/core/ui (7B-8 Task 3)"
```

---

## Task 4: Update @gmacko/core/ui exports + barrel

**Files:**
- Modify: `packages/core/src/ui/index.ts`
- Modify: `packages/core/package.json` (exports map)

**Step 1: Update barrel export**

Add all new components to `packages/core/src/ui/index.ts`:

```ts
export { Button, type ButtonProps, buttonVariants } from "./button";
export { Input } from "./input";
export { Badge, badgeVariants } from "./badge";
export { Card, CardHeader, CardContent, CardFooter } from "./card";
export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./dialog";
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuGroup, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuShortcut } from "./dropdown-menu";
export { ErrorBoundary } from "./error-boundary";
export { Field, fieldVariants } from "./field";
export { InlineEditable } from "./inline-editable";
export { Label } from "./label";
export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "./select";
export { Separator } from "./separator";
export { Textarea } from "./textarea";
export { Toaster, toast } from "./toast";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";
export { ThemeProvider, useTheme } from "./theme-provider";
export type { Theme, Mode, ResolvedMode } from "./theme-provider";
export { ThemeSwitcher } from "./theme-switcher";
export { cn } from "./utils";
export { MessageList, MessageBubble, Composer } from "./chat";
export * from "./branch-tree";
export * from "./layout";
```

**Step 2: Add subpath exports to `packages/core/package.json`**

Add export entries matching `@bob/ui`'s subpath pattern:

```json
"./ui/badge": "./src/ui/badge.tsx",
"./ui/card": "./src/ui/card.tsx",
"./ui/dialog": "./src/ui/dialog.tsx",
"./ui/dropdown-menu": "./src/ui/dropdown-menu.tsx",
"./ui/error-boundary": "./src/ui/error-boundary.tsx",
"./ui/field": "./src/ui/field.tsx",
"./ui/inline-editable": "./src/ui/inline-editable.tsx",
"./ui/label": "./src/ui/label.tsx",
"./ui/select": "./src/ui/select.tsx",
"./ui/separator": "./src/ui/separator.tsx",
"./ui/textarea": "./src/ui/textarea.tsx",
"./ui/toast": "./src/ui/toast.tsx",
"./ui/tooltip": "./src/ui/tooltip.tsx"
```

**Step 3: Typecheck**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run typecheck --concurrency=1
```

**Step 4: Commit**

```bash
git add packages/core/src/ui/index.ts packages/core/package.json
git commit -m "feat(ui): export all Shadcn components from @gmacko/core/ui (7B-8 Task 4)"
```

---

## Task 5: Rewire apps/bob imports from @bob/ui to @gmacko/core/ui

**Files:**
- Modify: 116 files in `apps/bob/src/` that import from `@bob/ui`

**Step 1: Bulk find-and-replace imports**

Mechanical rewire — every `@bob/ui` import path maps to `@gmacko/core/ui`:

| Old import | New import |
|---|---|
| `from "@bob/ui"` | `from "@gmacko/core/ui"` |
| `from "@bob/ui/button"` | `from "@gmacko/core/ui/button"` |
| `from "@bob/ui/badge"` | `from "@gmacko/core/ui/badge"` |
| `from "@bob/ui/card"` | `from "@gmacko/core/ui/card"` |
| `from "@bob/ui/dialog"` | `from "@gmacko/core/ui/dialog"` |
| `from "@bob/ui/input"` | `from "@gmacko/core/ui/input"` |
| `from "@bob/ui/label"` | `from "@gmacko/core/ui/label"` |
| `from "@bob/ui/select"` | `from "@gmacko/core/ui/select"` |
| `from "@bob/ui/separator"` | `from "@gmacko/core/ui/separator"` |
| `from "@bob/ui/textarea"` | `from "@gmacko/core/ui/textarea"` |
| `from "@bob/ui/toast"` | `from "@gmacko/core/ui/toast"` |
| `from "@bob/ui/tooltip"` | `from "@gmacko/core/ui/tooltip"` |
| `from "@bob/ui/theme"` | `from "@gmacko/core/ui/theme"` |
| `from "@bob/ui/error-boundary"` | `from "@gmacko/core/ui/error-boundary"` |
| `from "@bob/ui/inline-editable"` | `from "@gmacko/core/ui/inline-editable"` |

Use `sed` or similar for the bulk replacement across all 116 files. Also handle `vi.mock("@bob/ui` in test files.

Note: `@bob/ui/theme` exports `ThemeProvider`, `ThemeToggle`, `useTheme`, `themeDetectorScript`. Map these to:
- `ThemeProvider` → already in `@gmacko/core/ui` (the multi-theme version)
- `useTheme` → already in `@gmacko/core/ui` (returns `{theme, mode, setTheme, setMode, resolvedMode}` — Bob's callers use `themeMode` and `resolvedTheme`, so check for compatibility)
- `ThemeToggle` → needs to be added to `@gmacko/core/ui/theme-provider.tsx` or a separate file
- `themeDetectorScript` → Bob's flash-prevention script, can be added to the theme module

**Step 2: Handle `useTheme` API differences**

Bob's `useTheme()` returns `{ themeMode, resolvedTheme, setTheme, toggleMode }`.
Gmacko's `useTheme()` returns `{ theme, mode, setTheme, setMode, resolvedMode }`.

Two options:
- (A) Add a `useBobTheme()` compat hook that maps gmacko's API to Bob's shape
- (B) Update Bob's 2 consumers of `useTheme` to use gmacko's API

Option B is better — only 2 files import from `@bob/ui/theme`:
- `apps/bob/src/app/layout.tsx` — uses `ThemeProvider`, `ThemeToggle`
- `apps/bob/src/app/(dashboard)/settings/_components/preferences.tsx` — uses `useTheme`

Update these 2 files to use gmacko's API.

**Step 3: Add ThemeToggle and themeDetectorScript**

Copy Bob's `ThemeToggle` component and `themeDetectorScript` into `packages/core/src/ui/theme-provider.tsx` (or a new `packages/core/src/ui/theme-toggle.tsx`). Wire `ThemeToggle` to use gmacko's `useTheme()` context.

**Step 4: Remove `@bob/ui` from apps/bob/package.json dependency**

```bash
cd /Volumes/dev/gmacko/apps/bob
# Remove @bob/ui from dependencies, add @gmacko/core if not already there
```

**Step 5: Update apps/bob/src/app/styles.css**

Change:
```css
@import "@bob/tailwind-config/theme";
@source "../../../../packages/ui/src/*.{ts,tsx}";
```
To:
```css
@import "@gmacko/tailwind/theme";
@source "../../../../packages/core/src/ui/*.{ts,tsx}";
```

**Step 6: Typecheck and verify**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run typecheck --concurrency=1
```

**Step 7: Commit**

```bash
git add apps/bob/
git commit -m "refactor(bob): rewire 221 @bob/ui imports to @gmacko/core/ui (7B-8 Task 5)"
```

---

## Task 6: Update gmacko's existing components to use Shadcn tokens

**Files:**
- Modify: `packages/core/src/ui/theme-switcher.tsx`
- Modify: `packages/core/src/ui/layout/shell.tsx`
- Modify: `packages/core/src/ui/layout/sidebar.tsx`
- Modify: `packages/core/src/ui/layout/panel.tsx`
- Modify: `packages/core/src/ui/chat/composer.tsx`
- Modify: `packages/core/src/ui/chat/message-bubble.tsx`
- Modify: `packages/core/src/ui/chat/message-list.tsx`
- Modify: `packages/core/src/ui/branch-tree/*.tsx`

**Step 1: Replace `var(--color-*)` references with Tailwind semantic classes**

Mechanical replacement across all gmacko-original components:

| Old pattern | New pattern |
|---|---|
| `var(--color-bg)` | class `bg-background` |
| `var(--color-bg-secondary)` | class `bg-card` |
| `var(--color-bg-tertiary)` | class `bg-muted` |
| `var(--color-border)` | class `border-border` |
| `var(--color-border-hover)` | class `hover:border-ring` |
| `var(--color-text)` | class `text-foreground` |
| `var(--color-text-secondary)` | class `text-secondary-foreground` |
| `var(--color-text-muted)` | class `text-muted-foreground` |
| `var(--color-accent)` | class `bg-primary` / `text-primary` |
| `var(--color-accent-hover)` | class `hover:bg-primary/90` |
| `var(--color-error)` | class `text-destructive` |

This converts inline `style` and `bg-[var(--color-*)]` patterns to standard Tailwind classes.

**Step 2: Run core tests**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run test --filter=@gmacko/core --concurrency=1 -- --no-file-parallelism
```

**Step 3: Commit**

```bash
git add packages/core/src/ui/
git commit -m "refactor(ui): migrate gmacko components from CSS vars to Shadcn token classes (7B-8 Task 6)"
```

---

## Task 7: Update apps/core and apps/ooda CSS

**Files:**
- Modify: `apps/core/src/app/globals.css`
- Modify: `apps/ooda/src/app/globals.css`

**Step 1: Update both globals.css files**

Both currently just `@import "@gmacko/tailwind/theme"`. Add the `@custom-variant`, `@source`, and base layer directives that Bob's app uses:

```css
@import "@gmacko/tailwind/theme";
@import "tw-animate-css";

@custom-variant dark (&:where(.dark, .dark *));
@custom-variant light (&:where(.light, .light *));

@source "../../../../packages/core/src/ui/*.{ts,tsx}";

@layer base {
  * {
    @apply border-border;
  }
}
```

**Step 2: Verify apps build**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run typecheck --filter=@gmacko/core-app --filter=@gmacko/ooda
```

**Step 3: Commit**

```bash
git add apps/core/src/app/globals.css apps/ooda/src/app/globals.css
git commit -m "feat(apps): align core + ooda CSS with unified Shadcn theme (7B-8 Task 7)"
```

---

## Task 8: Run full test suite

**Step 1: Run all tests**

```bash
cd /Volumes/dev/gmacko && pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism
```

Expected: Core 458+ pass, Bob API 428+ pass + 1 skipped.

**Step 2: Fix any failures**

If theme-provider tests fail, update assertions to match the new `.dark`/`.light` class behavior instead of `data-mode` attribute checks.

**Step 3: Commit any fixes**

```bash
git commit -m "test: fix theme-related test assertions for Shadcn class convention (7B-8 Task 8)"
```

---

## Summary

| Task | What | Files touched |
|------|------|---------------|
| 1 | Unify theme CSS (Shadcn tokens + data-theme) | 1 |
| 2 | ThemeProvider: add .dark/.light class setting | 1 |
| 3 | Copy Bob's 15 components + replace button/input | 15 + deps |
| 4 | Update exports + barrel | 2 |
| 5 | Rewire 221 imports in apps/bob | 116 + styles |
| 6 | Migrate gmacko components to Shadcn classes | ~10 |
| 7 | Update core/ooda CSS | 2 |
| 8 | Full test suite verification | 0 (fixes only) |

After completion: single UI component library in `@gmacko/core/ui`, shared by Bob, OODA, and gmacko core. OODA gets its own look via `[data-theme="ooda"]` token set. `@bob/ui` stays in-tree as reference.

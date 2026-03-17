# UI Refresh — Implementation Plan

## Goal

Replace the default shadcn/Geist visual identity with Bob's design system (DESIGN.md): warm amber primary, Satoshi/DM Sans/JetBrains Mono typography, warm gray neutrals. Add Storybook for component documentation.

## Decisions

- **Font loading:** Self-host all three fonts as woff2 via `next/font/local` (no CDN dependency)
- **Font tokens:** Three Tailwind families — `font-display` (Satoshi), `font-sans` (DM Sans), `font-mono` (JetBrains Mono)
- **Color format:** Keep oklch (convert DESIGN.md hex values)
- **Component scope:** Fix all UI primitives that bypass the theme system
- **Storybook:** Add to `apps/web` with co-located stories, starting with UI primitives

## Steps

### Step 1: Download fonts
- Fetch woff2 files for Satoshi (400, 500, 700, 900), DM Sans (300, 400, 500, 600, 700, 400i), JetBrains Mono (400, 500, 600)
- Place in `apps/web/public/fonts/{satoshi,dm-sans,jetbrains-mono}/`

### Step 2: Update font loading (`apps/web/src/app/layout.tsx`)
- Remove Geist `next/font/google` imports
- Add three `next/font/local` declarations:
  - `satoshi` → `--font-satoshi`
  - `dmSans` → `--font-dm-sans`
  - `jetBrainsMono` → `--font-jetbrains-mono`
- Apply all three CSS variable classes to `<body>`

### Step 3: Update theme tokens (`tooling/tailwind/theme.css`)
- Replace `:root` color values with warm amber primary + warm gray neutrals (oklch)
- Replace `@variant dark` color values with warm dark palette (oklch)
- Add `--font-display: var(--font-satoshi)` to `@theme inline` block
- Update `--font-sans` and `--font-mono` mappings

### Step 4: Fix UI primitives (`packages/ui/src/`)
- **card.tsx:** `bg-black/20 border-white/10` → `bg-card border-border`
- **dialog.tsx:** Close button `white/40` → `text-muted-foreground`
- **select.tsx:** `bg-white/[0.04] border-white/10` → theme tokens
- **tooltip.tsx:** `bg-[#0c1120]` → `bg-popover`
- **inline-editable.tsx:** `bg-white/[0.04] border-white/20` → theme tokens
- **badge.tsx:** Default variant → theme tokens (color variants stay as-is)

### Step 5: Add font-display to headings
- Grep for heading patterns (`text-lg font-semibold`, `text-xl font-bold`, etc.) across `apps/web/src/components/`
- Add `font-display` class to page titles, section titles, card titles
- Target components: layout, dashboard, planning, projects, work-items, graph, forgegraph

### Step 6: Add Storybook
- Install `@storybook/react`, `@storybook/nextjs`, `storybook` in apps/web
- Create `apps/web/.storybook/main.ts` and `preview.ts`
- Import the theme CSS in preview so stories render with the design system
- Add `storybook` and `build-storybook` scripts to apps/web package.json
- Add `dev:storybook` to root package.json turbo pipeline

### Step 7: Write stories for UI primitives
- `packages/ui/src/button.stories.tsx` — all variants × sizes × states
- `packages/ui/src/badge.stories.tsx` — all color variants + contextual examples
- `packages/ui/src/card.stories.tsx` — with header, content, footer
- `packages/ui/src/input.stories.tsx` — states: default, focused, error, disabled
- `packages/ui/src/dialog.stories.tsx` — with form content
- `packages/ui/src/select.stories.tsx` — open/closed states
- `packages/ui/src/textarea.stories.tsx` — states
- `packages/ui/src/tooltip.stories.tsx` — positioned examples
- `packages/ui/src/separator.stories.tsx` — h + v
- `packages/ui/src/toast.stories.tsx` — success, error variants

### Step 8: Verify
- Run `pnpm typecheck`
- Run `pnpm dev:web` and visually verify light + dark modes
- Run Storybook and verify all stories render correctly

## Files Changed

~25 files total:
- `apps/web/src/app/layout.tsx`
- `tooling/tailwind/theme.css`
- `packages/ui/src/{card,dialog,select,tooltip,inline-editable,badge}.tsx`
- ~10 heading components in `apps/web/src/components/`
- `apps/web/.storybook/{main,preview}.ts`
- `apps/web/package.json`
- 10 story files in `packages/ui/src/`
- New font files in `apps/web/public/fonts/`

# Gmacko

Shared monorepo for Bob and OODA frontends. Will become the gmacko fork of t3code.

## Architecture

- `packages/ui` — Themeable shared UI components (@gmacko/ui)
- `packages/models` — Core domain types (threads, messages, branches)
- `apps/web` — Next.js 16 web app
- `apps/mobile` — Expo 53 mobile app
- `tooling/typescript` — Shared TypeScript config
- `tooling/tailwind` — Shared Tailwind theme with OODA + Bob presets

## Themes

Set `data-theme` attribute on root element: `"ooda"` (dark + gold) or `"bob"` (purple/indigo).

Theme tokens are CSS custom properties defined in `tooling/tailwind/theme.css`.

## Development

pnpm install
pnpm dev:web    # Start web app (Next.js + Turbopack)
pnpm dev:mobile # Start mobile app (Expo)
pnpm test       # Run all tests

## Key Patterns

- All UI components use CSS custom properties for theming (var(--color-*))
- Components use CVA (class-variance-authority) for variant styling
- Branch tree is the core navigation primitive
- Chat components accept @gmacko/models types
- Shell layout: sidebar (branches) + main (chat) + optional panel

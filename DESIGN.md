# Design System — Bob Builder

## Product Context
- **What this is:** AI-powered developer tool for planning and task execution — workspaces, projects, work items, terminals, and flow graphs
- **Who it's for:** Developers and technical teams who ship software
- **Space/industry:** Developer tools (peers: Linear, Cursor, Warp, Vercel, Raycast)
- **Project type:** Web app dashboard + mobile app

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal — typography and structure carry the design
- **Mood:** A well-lit workshop where real work happens. Warm, confident, workmanlike. The opposite of cold/clinical dev tools. Function-first but not soulless.
- **Reference sites:** Linear (monochrome, cold — we go warmer), Vercel (Swiss minimalism — we share the discipline but not the Geist identity), Warp (dark-native terminal — our terminal contexts follow this lead)

## Typography
- **Display/Hero:** Satoshi — geometric, confident, distinctive. Not as everywhere as Inter, not as tied to Vercel as Geist. Use for page titles, section headings, card titles.
- **Body:** DM Sans — humanist warmth, excellent readability at small sizes. Use for body text, UI labels, descriptions, navigation.
- **UI/Labels:** DM Sans (same as body) at 12-14px, weight 500-600
- **Data/Tables:** DM Sans (tabular-nums) for numeric data, JetBrains Mono for task IDs, hashes, and technical identifiers
- **Code:** JetBrains Mono — industry standard, excellent in terminals and code blocks
- **Loading:** Satoshi via Fontshare CDN (`https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap`), DM Sans + JetBrains Mono via Google Fonts
- **Scale:**
  - Display XL: 72px / 900 weight / -0.03em tracking / 1.05 line-height
  - Display: 48px / 900 weight / -0.03em tracking / 1.05 line-height
  - H1: 36px / 700 weight / -0.02em tracking / 1.15 line-height
  - H2: 28px / 700 weight / -0.02em tracking / 1.2 line-height
  - H3: 24px / 700 weight / -0.015em tracking / 1.2 line-height
  - H4: 18px / 600 weight / -0.01em tracking / 1.3 line-height
  - Body: 16px / 400 weight / normal tracking / 1.6 line-height
  - Body SM: 14px / 400-500 weight / normal tracking / 1.5 line-height
  - Caption: 13px / 400 weight / normal tracking / 1.5 line-height
  - Label: 12px / 600 weight / 0.04em tracking / uppercase
  - Mono: 13-14px / 400 weight / normal tracking / 1.6 line-height

## Color
- **Approach:** Restrained — one accent + warm neutrals. Color is rare and meaningful.
- **Primary:** `#D4850A` (oklch 0.68 0.155 70) — warm amber. Evokes construction, confidence, warmth. Used for CTAs, active states, focus rings, and key UI affordances.
  - Hover: `#B87208`
  - Muted: `#F5DEB3`
  - Subtle: `#FFF3E0`
  - Dark mode primary: `#E8A33C` (lighter for contrast on dark surfaces)
  - Dark mode hover: `#F0B45A`
  - Dark mode muted: `#3D3120`
  - Dark mode subtle: `#2C2418`
- **Neutrals (warm grays):**
  - 900: `#1C1B18` — primary text (light mode), dark surfaces
  - 800: `#3D3B36`
  - 700: `#5C5A53` — secondary text (light mode)
  - 500: `#8A877E` — muted text, placeholders
  - 400: `#B5B2AB`
  - 200: `#E3E1DC` — borders (light mode)
  - 100: `#EEEDEA` — subtle borders, inset backgrounds
  - 50: `#F5F4F1` — subtle backgrounds
  - 25: `#FAFAF8` — page background (light mode)
  - White: `#FFFFFF` — elevated surfaces (light mode)
  - Dark mode backgrounds: `#141310` (page), `#1C1B18` (elevated), `#232220` (subtle), `#0E0D0B` (inset)
  - Dark mode borders: `#2E2D2A` (primary), `#232220` (subtle)
  - Dark mode text: `#EEEDEA` (primary), `#A8A59E` (secondary), `#6E6B64` (muted)
- **Semantic:**
  - Success: `#2D8A4E` (light) / `#4CAF50` (dark) — subtle bg: `#E8F5E9` / `#1B2E1D`
  - Warning: `#D4850A` (light) / `#E8A33C` (dark) — subtle bg: `#FFF3E0` / `#2C2418`
  - Error: `#C62828` (light) / `#EF5350` (dark) — subtle bg: `#FFEBEE` / `#2E1616`
  - Info: `#1565C0` (light) / `#42A5F5` (dark) — subtle bg: `#E3F2FD` / `#162230`
- **Dark mode strategy:** Warm dark backgrounds (not pure black), reduce primary saturation slightly, lighten semantic colors for readability. All surfaces maintain the warm undertone — never cold blue-black.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — dashboard needs data density without feeling cramped
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment. Dashboard with terminals and flow graphs needs spatial order.
- **Grid:** 12 columns. Sidebar + content layout for dashboard. Full-width for focused views (terminal, flow graph).
- **Max content width:** 1400px (with 32px inline padding)
- **Border radius:** sm: 4px (badges, small elements), md: 8px (buttons, inputs, cards), lg: 12px (panels, modals, specimens), full: 9999px (pills, status dots)

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension. This is a work tool, not a showroom.
- **Easing:** enter: ease-out, exit: ease-in, move: ease-in-out
- **Duration:** micro: 50-100ms (hover states), short: 150ms (button presses, toggles), medium: 250ms (panels, drawers), long: 400ms (page transitions — use sparingly)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-17 | Initial design system created | Created by /design-consultation based on competitive research of Linear, Vercel, Raycast, Warp, Cursor |
| 2026-03-17 | Warm amber primary over pink/magenta | Pink/magenta was a shadcn default with no product connection. Amber evokes construction/building, differentiates from cold blue/purple dev tool space |
| 2026-03-17 | Satoshi + DM Sans over Geist | Geist is Vercel's identity font — using it makes Bob look like a Vercel template. Satoshi is geometric and confident, DM Sans has humanist warmth |
| 2026-03-17 | Warm grays over cool grays | Every competitor uses cold blue-gray neutrals. Warm grays reinforce the "workshop" aesthetic and pair naturally with amber |
| 2026-03-17 | Industrial/Utilitarian aesthetic | Developer tools are converging on Linear's cold monochrome style. Bob's identity as a "builder" supports a warmer, more workmanlike direction |

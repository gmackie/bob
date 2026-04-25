# @gmacko/ui

Themeable shared UI components for gmacko products (Bob, OODA, etc).

## Theming model

Two-axis: **theme** (palette family) × **mode** (light/dark variant).

- `data-theme="bob"` — warm-amber primary, warm-gray neutrals (per Bob's DESIGN.md)
- `data-theme="ooda"` — placeholder dark+gold (OODA team will refine light/dark variants)
- `data-mode="light"` — light surfaces (default if `data-mode` is unset)
- `data-mode="dark"` — dark surfaces

Token CSS lives in `tooling/tailwind/theme.css`. Components consume tokens via `var(--color-*)` etc.

## Usage

Wrap your app in `<ThemeProvider>`:

```tsx
import { ThemeProvider } from "@gmacko/ui";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Bob's display font — required when data-theme="bob" */}
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" />
      </head>
      <body>
        <ThemeProvider defaultTheme="bob" defaultMode="system">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

## ThemeProvider API

```ts
<ThemeProvider
  defaultTheme="bob" | "ooda"
  defaultMode?="light" | "dark" | "system"  // default "system"
>
  {children}
</ThemeProvider>

const { theme, setTheme, mode, setMode, resolvedMode } = useTheme();
// resolvedMode is always "light" | "dark" — even when mode === "system"
```

`mode === "system"` attaches a `prefers-color-scheme` media-query listener and updates `data-mode` reactively. Both `theme` and `mode` (NOT `resolvedMode`) persist to `localStorage`.

## Components

- `<Button>` — variants (default, ghost, outline, destructive) × sizes (sm, md, lg, icon).
- `<Input>` — themed text input.
- `<ChatComposer>`, `<MessageList>` — agent chat primitives.
- `<BranchTree>` — branch graph view.
- `<ThemeSwitcher>` — UI for theme + mode selection.

## Bob theme — Satoshi font

Bob's DESIGN.md specifies Satoshi (display) + DM Sans (body) + JetBrains Mono (data). Self-host Satoshi or load via Fontshare CDN as shown above. The token `--font-display` references Satoshi by default.

## Adding new tokens

Tokens live in `tooling/tailwind/theme.css` under `@theme` (root tokens) or per-theme `[data-theme="X"][:not()][data-mode="Y"]` blocks. After adding tokens, components consume via `var(--token-name)` in className strings.

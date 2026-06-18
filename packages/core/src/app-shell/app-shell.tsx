"use client";

import type { ReactNode } from "react";

export interface AppShellProps {
  /** Optional left-side navigation. Rendered in the sidebar slot. */
  readonly sidebar?: ReactNode;
  /** Optional top-of-page header / nav. Rendered above the content. */
  readonly header?: ReactNode;
  /** Main page content. */
  readonly children: ReactNode;
  /** Customize the wrapper className for app-level styling. */
  readonly className?: string;
}

/**
 * Three-slot layout primitive: sidebar (left), header (top), content (main).
 * Uses CSS Grid with theme tokens for surfaces. SSR-safe: no client-only
 * imports at module level.
 */
export function AppShell({
  sidebar,
  header,
  children,
  className,
}: AppShellProps) {
  const hasSidebar = sidebar != null;
  const hasHeader = header != null;

  return (
    <div
      className={className}
      data-app-shell
      style={{
        display: "grid",
        minHeight: "100vh",
        gridTemplateColumns: hasSidebar ? "auto 1fr" : "1fr",
        gridTemplateRows: hasHeader ? "auto 1fr" : "1fr",
        gridTemplateAreas: hasSidebar
          ? hasHeader
            ? '"sidebar header" "sidebar content"'
            : '"sidebar content"'
          : hasHeader
            ? '"header" "content"'
            : '"content"',
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      {hasSidebar ? (
        <aside
          data-app-shell-sidebar
          style={{
            gridArea: "sidebar",
            background: "var(--color-bg-secondary)",
            borderRight: "1px solid var(--color-border)",
          }}
        >
          {sidebar}
        </aside>
      ) : null}
      {hasHeader ? (
        <header
          data-app-shell-header
          style={{
            gridArea: "header",
            background: "var(--color-bg-secondary)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {header}
        </header>
      ) : null}
      <main data-app-shell-content style={{ gridArea: "content" }}>
        {children}
      </main>
    </div>
  );
}

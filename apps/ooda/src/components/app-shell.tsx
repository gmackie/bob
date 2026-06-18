"use client";

import { CommandPalette } from "~/components/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CommandPalette />
    </>
  );
}

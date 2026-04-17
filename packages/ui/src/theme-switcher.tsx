"use client";

import { useTheme } from "./theme-provider";
import { cn } from "./utils";

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg bg-[var(--color-bg-tertiary)] p-1",
        className,
      )}
    >
      <button
        onClick={() => setTheme("ooda")}
        className={cn(
          "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          theme === "ooda"
            ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        )}
      >
        OODA
      </button>
      <button
        onClick={() => setTheme("bob")}
        className={cn(
          "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          theme === "bob"
            ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        )}
      >
        Bob
      </button>
    </div>
  );
}

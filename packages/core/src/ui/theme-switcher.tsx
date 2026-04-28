"use client";

import { useTheme } from "./theme-provider";
import { cn } from "./utils";

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme, mode, setMode } = useTheme();

  return (
    <div
      className={cn(
        "inline-flex flex-col gap-1 rounded-lg bg-[var(--color-bg-tertiary)] p-1",
        className,
      )}
    >
      {/* Theme row */}
      <div className="flex items-center gap-1">
        <button
          type="button"
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
          type="button"
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
      {/* Mode row */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode("light")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "light"
              ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          Light
        </button>
        <button
          type="button"
          onClick={() => setMode("dark")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "dark"
              ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          Dark
        </button>
        <button
          type="button"
          onClick={() => setMode("system")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "system"
              ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          System
        </button>
      </div>
    </div>
  );
}

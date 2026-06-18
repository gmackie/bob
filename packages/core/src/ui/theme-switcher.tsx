"use client";

import { useTheme } from "./theme-provider";
import { cn } from "./utils";

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme, mode, setMode } = useTheme();

  return (
    <div
      className={cn(
        "inline-flex flex-col gap-1 rounded-lg bg-muted p-1",
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
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
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
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
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
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
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
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
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
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          System
        </button>
      </div>
    </div>
  );
}

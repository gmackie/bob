"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@linear-clone/ui/components/button";
import { ALL_SHORTCUTS } from "@/hooks/use-keyboard-shortcuts";

export function KeyboardShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleShowHelp = () => setIsOpen(true);
    document.addEventListener("show-shortcuts-help", handleShowHelp);
    return () =>
      document.removeEventListener("show-shortcuts-help", handleShowHelp);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const categories = Array.from(
    new Set(ALL_SHORTCUTS.map((s) => s.category))
  );

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      <div className="relative mx-auto mt-[10vh] w-full max-w-2xl">
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-6">
            <div className="grid gap-8 sm:grid-cols-2">
              {categories.map((category) => (
                <div key={category}>
                  <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {ALL_SHORTCUTS.filter((s) => s.category === category).map(
                      (shortcut) => (
                        <div
                          key={shortcut.key}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm">{shortcut.description}</span>
                          <kbd className="ml-2 rounded border border-border bg-muted px-2 py-1 text-xs font-medium">
                            {shortcut.key}
                          </kbd>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border px-6 py-3 text-center text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">?</kbd> anytime to show this help
          </div>
        </div>
      </div>
    </div>
  );
}

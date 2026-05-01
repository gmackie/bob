"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@gmacko/core/ui";
import { useTRPC } from "~/trpc/react";

interface CaptureResult {
  url: string;
  filename: string;
  capturedAt: string;
}

export function FloatingCapture() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [recentCaptures, setRecentCaptures] = useState<CaptureResult[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const captureMutation = useMutation(
    trpc.capture.capture.mutationOptions({
      onSuccess: (data) => {
        setRecentCaptures((prev) =>
          [
            { url: data.url, filename: data.filename, capturedAt: data.capturedAt },
            ...prev,
          ].slice(0, 3),
        );
      },
    }),
  );

  // Close popup on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  function handleScreenshot() {
    captureMutation.mutate({ targetType: "screen" });
  }

  function handleAttachToChat() {
    // Capture then attach to active chat — capture first
    captureMutation.mutate({ targetType: "screen" });
    // The parent context would pick up the latest capture for the active session
  }

  function handleAttachToWorkItem() {
    // Capture, then user picks a work item from the picker
    captureMutation.mutate({ targetType: "screen" });
  }

  return (
    <div ref={menuRef} className="fixed bottom-6 right-6 z-50">
      {/* Popup menu */}
      {open && (
        <div
          className={cn(
            "absolute bottom-14 right-0 w-56 rounded-xl border border-border bg-card shadow-lg",
            "animate-in fade-in slide-in-from-bottom-2 duration-200",
          )}
        >
          <div className="p-2 space-y-0.5">
            <button
              type="button"
              onClick={handleScreenshot}
              disabled={captureMutation.isPending}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <svg
                className="size-4 shrink-0 text-muted-foreground"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <circle cx="8" cy="8" r="2.5" />
              </svg>
              <span>Screenshot</span>
            </button>

            <button
              type="button"
              onClick={handleAttachToChat}
              disabled={captureMutation.isPending}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <svg
                className="size-4 shrink-0 text-muted-foreground"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4 12l-2 2V4a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H4z" />
              </svg>
              <span>Attach to chat</span>
            </button>

            <button
              type="button"
              onClick={handleAttachToWorkItem}
              disabled={captureMutation.isPending}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <svg
                className="size-4 shrink-0 text-muted-foreground"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
                <path d="M6 8h4M8 6v4" />
              </svg>
              <span>Attach to work item</span>
            </button>
          </div>

          {/* Recent captures */}
          {recentCaptures.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Recent
              </p>
              <div className="flex gap-1.5">
                {recentCaptures.map((cap) => (
                  <div
                    key={cap.capturedAt}
                    className="size-10 rounded-md border border-border bg-muted/30 overflow-hidden"
                    title={cap.filename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cap.url}
                      alt={cap.filename}
                      className="size-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {captureMutation.isPending && (
            <div className="border-t border-border px-3 py-2">
              <p className="text-xs text-muted-foreground animate-pulse">
                Capturing...
              </p>
            </div>
          )}
        </div>
      )}

      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-12 items-center justify-center rounded-full shadow-lg",
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90 active:scale-95",
          "transition-all duration-150",
        )}
        title="Capture"
      >
        <svg
          className="size-5"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <rect x="3" y="5" width="14" height="11" rx="2" />
          <circle cx="10" cy="10.5" r="3" />
          <path d="M7 5l1-2h4l1 2" />
        </svg>
      </button>
    </div>
  );
}

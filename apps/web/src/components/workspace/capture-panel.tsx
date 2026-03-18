"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface CaptureResult {
  url: string;
  filename: string;
  width: number;
  height: number;
  capturedAt: string;
}

type AutoInterval = 0 | 5000 | 10000 | 30000;

const AUTO_INTERVAL_OPTIONS: { label: string; value: AutoInterval }[] = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
];

const MAX_HISTORY = 20;

export function CapturePanel() {
  const trpc = useTRPC();

  // State
  const [selectedTargetId, setSelectedTargetId] = useState("screen");
  const [url, setUrl] = useState("");
  const [autoInterval, setAutoInterval] = useState<AutoInterval>(0);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyStripRef = useRef<HTMLDivElement>(null);

  // Queries
  const { data: targets } = useQuery(
    trpc.capture.listTargets.queryOptions(),
  );

  const selectedTarget = targets?.find((t) => t.id === selectedTargetId);

  // Mutation
  const captureMutation = useMutation(
    trpc.capture.capture.mutationOptions({
      onSuccess: (result) => {
        setCaptures((prev) => {
          const next = [...prev, result];
          if (next.length > MAX_HISTORY) {
            return next.slice(next.length - MAX_HISTORY);
          }
          return next;
        });
        // Auto-select the new capture
        setActiveIndex(null); // will resolve to latest via derived value
      },
    }),
  );

  const doCapture = useCallback(() => {
    if (captureMutation.isPending) return;
    captureMutation.mutate({
      targetType: (selectedTarget?.type ?? "screen") as "browser" | "window" | "screen",
      targetId: selectedTargetId,
      url: selectedTarget?.type === "browser" ? url : undefined,
    });
  }, [captureMutation, selectedTarget, selectedTargetId, url]);

  // Auto-capture interval
  useEffect(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (autoInterval > 0) {
      autoTimerRef.current = setInterval(doCapture, autoInterval);
    }
    return () => {
      if (autoTimerRef.current) {
        clearInterval(autoTimerRef.current);
      }
    };
  }, [autoInterval, doCapture]);

  // Scroll history strip to the right when new captures arrive
  useEffect(() => {
    if (historyStripRef.current) {
      historyStripRef.current.scrollLeft = historyStripRef.current.scrollWidth;
    }
  }, [captures.length]);

  // Derived: active capture
  const activeCapture =
    activeIndex !== null ? captures[activeIndex] : captures[captures.length - 1];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        {/* Label + indicator */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Screen Capture
          </span>
          {captureMutation.isPending && (
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" title="Capturing..." />
          )}
          {autoInterval > 0 && !captureMutation.isPending && (
            <span className="h-2 w-2 rounded-full bg-green-500" title="Auto-capture active" />
          )}
        </div>

        {/* Separator */}
        <div className="h-4 w-px bg-border" />

        {/* Target selector */}
        <select
          value={selectedTargetId}
          onChange={(e) => setSelectedTargetId(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
        >
          {targets?.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.connected}>
              {t.name}{!t.connected ? " (unavailable)" : ""}
            </option>
          ))}
        </select>

        {/* URL input for browser targets */}
        {selectedTarget?.type === "browser" && (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        )}

        {/* Capture button */}
        <button
          type="button"
          onClick={doCapture}
          disabled={captureMutation.isPending || (selectedTarget?.type === "browser" && !url)}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {captureMutation.isPending ? "Capturing..." : "Capture Now"}
        </button>

        {/* Auto-capture selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Auto:</span>
          <select
            value={autoInterval}
            onChange={(e) => setAutoInterval(Number(e.target.value) as AutoInterval)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          >
            {AUTO_INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main capture area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background p-4">
        {activeCapture ? (
          <a
            href={activeCapture.url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative block max-h-full max-w-full"
            title="Click to open full size"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeCapture.url}
              alt={`Capture from ${activeCapture.capturedAt}`}
              className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-sm"
            />
          </a>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              className="text-muted-foreground/40"
            >
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 8h2M19 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <p className="text-sm font-medium text-muted-foreground">No captures yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Select a target and click &quot;Capture Now&quot; to take a screenshot
              </p>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {captureMutation.isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <div className="flex flex-col items-center gap-2">
              <svg
                className="h-8 w-8 animate-spin text-primary"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="opacity-20"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-xs text-muted-foreground">Capturing...</span>
            </div>
          </div>
        )}
      </div>

      {/* Send to Chat button */}
      {activeCapture && (
        <div className="flex items-center justify-end border-t border-border bg-card px-4 py-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {activeCapture.capturedAt
              ? new Date(activeCapture.capturedAt).toLocaleTimeString()
              : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              // Dispatch a custom event that the chat can listen for
              window.dispatchEvent(
                new CustomEvent("bob:attach-capture", {
                  detail: { url: activeCapture.url, filename: activeCapture.filename },
                }),
              );
            }}
            className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
          >
            Send to Chat
          </button>
        </div>
      )}

      {/* Capture history strip */}
      {captures.length > 0 && (
        <div className="border-t border-border bg-card px-4 py-2">
          <div
            ref={historyStripRef}
            className="flex gap-2 overflow-x-auto"
          >
            {captures.map((cap, idx) => {
              const isActive =
                activeIndex !== null ? idx === activeIndex : idx === captures.length - 1;
              return (
                <button
                  key={cap.capturedAt + cap.filename}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`h-10 w-16 shrink-0 overflow-hidden rounded border transition ${
                    isActive
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  title={new Date(cap.capturedAt).toLocaleTimeString()}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cap.url}
                    alt={`Capture ${idx + 1}`}
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error display */}
      {captureMutation.isError && (
        <div className="border-t border-border bg-red-500/10 px-4 py-2 text-xs text-red-500">
          Capture failed: {captureMutation.error.message}
        </div>
      )}
    </div>
  );
}

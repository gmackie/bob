"use client";

import { useState } from "react";

import type { ToolCallEvent } from "../_hooks/useBuddyEvents";
import { useBuddyEvents } from "../_hooks/useBuddyEvents";

interface ToolFeedProps {
  threadId: string;
}

type StatusClass = "bg-green-500" | "bg-red-500" | "bg-amber-500";

function statusDotClass(event: ToolCallEvent): StatusClass {
  const status = (event.status ?? "").toLowerCase();
  if (status === "ok" || status === "success" || status === "completed") {
    return "bg-green-500";
  }
  if (status === "error" || status === "failed" || status === "failure") {
    return "bg-red-500";
  }
  // Default (in-flight, pending, unknown) -- amber.
  return "bg-amber-500";
}

function toolKindLabel(toolName: string): string {
  // Extract a short "kind" prefix -- e.g. "web.search" -> "web", "db" -> "db".
  const dot = toolName.indexOf(".");
  const colon = toolName.indexOf(":");
  const cut = [dot, colon].filter((i) => i > 0).sort((a, b) => a - b)[0];
  if (cut && cut > 0) return toolName.slice(0, cut);
  return toolName.slice(0, 8) || "tool";
}

export function ToolFeed({ threadId }: ToolFeedProps) {
  const { toolCalls, status } = useBuddyEvents(threadId);

  return (
    <div data-testid="tool-feed" className="flex h-full flex-col gap-2 p-3">
      {status !== "open" && (
        <div
          role="status"
          data-testid="tool-feed-banner"
          className={`rounded border px-3 py-2 font-mono text-xs ${
            status === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-400"
          }`}
        >
          {status === "error" ? "connection error" : "connecting..."}
        </div>
      )}

      {toolCalls.length === 0 ? (
        <div className="rounded border border-[#2A2A2F] bg-[#1A1A1E] px-3 py-6 text-center font-mono text-xs text-[#5A5855]">
          no tool calls yet
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {toolCalls.map((event) => (
            <ToolCallRow key={`${event.id}-${event.received_at}`} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ToolCallRowProps {
  event: ToolCallEvent;
}

function ToolCallRow({ event }: ToolCallRowProps) {
  const [open, setOpen] = useState(false);
  const dot = statusDotClass(event);
  const duration = event.duration_ms ?? null;
  const statusText = (event.status ?? "in-flight").toString();

  return (
    <li
      data-testid="tool-call-row"
      className="rounded border border-[#2A2A2F] bg-[#1A1A1E] font-mono text-xs text-[#E8E4DF]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#22222A]"
      >
        <span className="rounded-[3px] bg-[#2A2A2F] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#8A8580]">
          {toolKindLabel(event.tool_name)}
        </span>
        <span className="flex-1 truncate">
          <span className="text-[#E8E4DF]">{event.tool_name}</span>
          <span className="mx-2 text-[#5A5855]">{"•"}</span>
          <span
            data-testid="status-dot"
            aria-label={statusText}
            className={`inline-block h-2 w-2 rounded-full align-middle ${dot}`}
          />
          <span className="ml-2 text-[#8A8580]">{statusText}</span>
          <span className="mx-2 text-[#5A5855]">{"•"}</span>
          <span className="text-[#8A8580]">
            {duration === null ? "--" : `${duration}ms`}
          </span>
        </span>
        <span className="text-[#5A5855]" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div
          data-testid="tool-call-details"
          className="border-t border-[#2A2A2F] bg-[#111113] px-3 py-2"
        >
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[#5A5855]">
            args
          </div>
          <pre
            data-testid="tool-call-args"
            className="max-h-48 overflow-auto rounded bg-[#0A0A0C] p-2 text-[11px] text-[#D4A04A]"
          >
            {formatJson(event.args)}
          </pre>
          <div className="mt-2 mb-1 text-[10px] uppercase tracking-wide text-[#5A5855]">
            result
          </div>
          <pre
            data-testid="tool-call-result"
            className="max-h-48 overflow-auto rounded bg-[#0A0A0C] p-2 text-[11px] text-[#8A8580]"
          >
            {formatJson(event.result)}
          </pre>
        </div>
      )}
    </li>
  );
}

function formatJson(value: unknown): string {
  if (value === undefined) return "(none)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Fallback for values that cannot be serialized (e.g. circular refs).
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "(unserializable)";
  }
}

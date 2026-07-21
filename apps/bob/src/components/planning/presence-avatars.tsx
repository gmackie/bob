"use client";

import { cn } from "@gmacko/core/ui";

import type { PlanningPresence } from "~/hooks/use-planning-collaboration";

const FOCUS_LABEL: Record<string, string> = {
  chat: "in collab chat",
  artifact: "editing artifact",
  drafts: "on drafts",
  agent: "with agent",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 42%)`;
}

interface PresenceAvatarsProps {
  participants: PlanningPresence[];
  currentUserId?: string | null;
  className?: string;
  max?: number;
}

export function PresenceAvatars({
  participants,
  currentUserId,
  className,
  max = 5,
}: PresenceAvatarsProps) {
  if (participants.length === 0) return null;

  const ordered = [...participants].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
  const visible = ordered.slice(0, max);
  const overflow = ordered.length - visible.length;

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      title={ordered
        .map(
          (p) =>
            `${p.displayName}${p.focus ? ` (${FOCUS_LABEL[p.focus] ?? p.focus})` : ""}`,
        )
        .join(", ")}
    >
      <div className="flex -space-x-2">
        {visible.map((p) => (
          <div
            key={`${p.userId}:${p.clientId}`}
            className="relative size-7 overflow-hidden rounded-full border-2 border-card ring-0"
            style={{ backgroundColor: colorForUser(p.userId) }}
          >
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.imageUrl}
                alt={p.displayName}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center text-[10px] font-semibold text-white">
                {initials(p.displayName)}
              </span>
            )}
            {p.focus === "artifact" ? (
              <span className="absolute bottom-0 right-0 size-2 rounded-full bg-amber-400 ring-1 ring-card" />
            ) : null}
          </div>
        ))}
        {overflow > 0 ? (
          <div className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
            +{overflow}
          </div>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {ordered.length} online
      </span>
    </div>
  );
}

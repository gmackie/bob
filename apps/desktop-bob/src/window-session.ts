import { createHash } from "node:crypto";

export function desktopSessionPartition(mode: { kind: "local" } | { kind: "connected"; appUrl: string }): string {
  return mode.kind === "local" ? "persist:bob-local" : `persist:bob-${createHash("sha256").update(mode.appUrl).digest("hex").slice(0, 16)}`;
}

/** Status belongs to the supervisor; page navigation must not erase it. */
export function preserveSupervisorTitle(window: {
  on(event: "page-title-updated", callback: (event: { preventDefault(): void }) => void): unknown;
}): void {
  window.on("page-title-updated", (event) => event.preventDefault());
}

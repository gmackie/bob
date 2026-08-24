"use client";

/**
 * /cockpit — Bob's live SDLC wall. V1: read-only, motion level "live".
 * ?ooda=1 shows OODA-originated work too (hidden by default).
 * Ops mode (controls) arrives in V2 on this same route.
 */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AgentStage, HeaderStrip, PrPipelines, QueueLanes, Timeline24h } from "~/components/cockpit/wall";
import { useCockpit } from "~/components/cockpit/use-cockpit";

function CockpitInner() {
  const params = useSearchParams();
  const includeOoda = params?.get("ooda") === "1";
  const { status, isLoading, error, feeds, feedVersion, connectionState, staleSeconds } = useCockpit({ includeOoda });

  if (isLoading || !status) {
    return (
      <div className="flex h-screen items-center justify-center font-mono text-sm text-white/40">
        {error ? `cockpit failed: ${error.message}` : "spinning up cockpit…"}
      </div>
    );
  }

  const stale = (staleSeconds ?? 0) > 60 || connectionState === "disconnected";

  return (
    <div className="flex h-screen flex-col">
      <style>{`@keyframes cockpit-enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }`}</style>
      {stale && (
        <div className="bg-amber-500/90 px-6 py-1 text-center font-mono text-xs text-black">
          data may be stale — {connectionState === "disconnected" ? "gateway disconnected, retrying" : `last update ${staleSeconds}s ago`}
        </div>
      )}
      <HeaderStrip status={status} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_2fr_1.2fr] gap-4 p-4">
        <QueueLanes status={status} />
        <AgentStage sessions={status.sessions} feeds={feeds} feedVersion={feedVersion} />
        <PrPipelines status={status} />
      </div>
      <Timeline24h status={status} />
    </div>
  );
}

export default function CockpitPage() {
  return (
    <Suspense fallback={null}>
      <CockpitInner />
    </Suspense>
  );
}

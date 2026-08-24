"use client";

/**
 * /cockpit — Bob's live SDLC wall.
 * ?ooda=1 shows OODA-originated work too (hidden by default).
 * ?mode=ops enables the owner-only controls; the header button toggles too.
 * Motion levels minimal/live/ambient/spectacle cycle from the header
 * (ambient+ renders the spectacle canvas behind the wall).
 */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useEffect, useRef, useState } from "react";

import { useCockpitActions } from "~/components/cockpit/controls";
import { SpectacleLayer, type BurstKind } from "~/components/cockpit/spectacle";
import { AgentStage, HeaderStrip, PrPipelines, QueueLanes, Timeline24h } from "~/components/cockpit/wall";
import { useCockpit } from "~/components/cockpit/use-cockpit";
import { useCockpitMotion } from "~/components/cockpit/use-motion";
import { useCockpitSound } from "~/components/cockpit/use-sound";

function CockpitInner() {
  const params = useSearchParams();
  const includeOoda = params?.get("ooda") === "1";
  const [mode, setMode] = useState<"wall" | "ops">(params?.get("mode") === "ops" ? "ops" : "wall");
  const { status, isLoading, error, feeds, feedVersion, connectionState, staleSeconds } = useCockpit({ includeOoda });
  const actions = useCockpitActions();
  const ops = mode === "ops" ? actions : null;
  const sound = useCockpitSound();
  const motion = useCockpitMotion();
  const burstQueueRef = useRef<BurstKind[]>([]);

  // New merges/deploys/failures between polls drive both chimes and bursts.
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const last = lastSeenRef.current;
    lastSeenRef.current = status.generatedAt;
    if (!last) return;
    for (const e of status.timeline) {
      if (e.at <= last) continue;
      let kind: BurstKind | null = null;
      if (e.kind === "merge") kind = "merge";
      else if (e.kind === "deploy") kind = "deploy";
      else if (e.kind === "failure" || e.kind === "deploy_failed") kind = "failure";
      else if (e.kind === "pr") kind = "pr";
      if (kind) {
        sound.play(kind);
        burstQueueRef.current.push(kind);
      }
    }
  }, [status, sound]);

  if (isLoading || !status) {
    return (
      <div className="flex h-screen items-center justify-center font-mono text-sm text-white/40">
        {error ? `cockpit failed: ${error.message}` : "spinning up cockpit…"}
      </div>
    );
  }

  const stale = (staleSeconds ?? 0) > 60 || connectionState === "disconnected";

  return (
    <div className="relative flex h-screen flex-col">
      <style>{`@keyframes cockpit-enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }`}</style>
      {motion.level === "minimal" && (
        <style>{`.cockpit-content *, .cockpit-content { animation: none !important; transition: none !important; }`}</style>
      )}
      <SpectacleLayer level={motion.level} sessions={status.sessions} feeds={feeds} burstQueueRef={burstQueueRef} />
      <div className="cockpit-content relative z-10 flex min-h-0 flex-1 flex-col">
        {stale && (
          <div className="bg-amber-500/90 px-6 py-1 text-center font-mono text-xs text-black">
            data may be stale — {connectionState === "disconnected" ? "gateway disconnected, retrying" : `last update ${staleSeconds}s ago`}
          </div>
        )}
        <HeaderStrip
          status={status}
          ops={ops}
          soundEnabled={sound.enabled}
          onToggleSound={sound.toggle}
          onToggleMode={() => setMode((m) => (m === "wall" ? "ops" : "wall"))}
          mode={mode}
          motionLevel={motion.level}
          onCycleMotion={motion.cycle}
        />
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_2fr_1.2fr] gap-4 p-4">
          <QueueLanes status={status} ops={ops} />
          <AgentStage sessions={status.sessions} feeds={feeds} feedVersion={feedVersion} ops={ops} />
          <PrPipelines status={status} ops={ops} />
        </div>
        <Timeline24h status={status} />
      </div>
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

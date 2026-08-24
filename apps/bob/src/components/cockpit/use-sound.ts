"use client";

/**
 * Cockpit sound: short WebAudio chimes on loop events (no assets). Default ON
 * with a persisted toggle; auto-muted under prefers-reduced-motion. Browsers
 * block audio before a user gesture — the first click on the page unlocks it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "cockpit.sound";

function chime(ctx: AudioContext, notes: [number, number][], type: OscillatorType = "sine") {
  let t = ctx.currentTime;
  for (const [freq, dur] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    t += dur * 0.8;
  }
}

export function useCockpitSound() {
  const [enabled, setEnabled] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(stored != null ? stored === "on" : !reduced);
    const unlock = () => {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      void ctxRef.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      localStorage.setItem(KEY, v ? "off" : "on");
      return !v;
    });
  }, []);

  const play = useCallback(
    (kind: "merge" | "deploy" | "failure" | "pr") => {
      if (!enabled) return;
      const ctx = ctxRef.current;
      if (!ctx || ctx.state !== "running") return;
      if (kind === "merge") chime(ctx, [[660, 0.12], [880, 0.18]]);
      else if (kind === "deploy") chime(ctx, [[523, 0.1], [659, 0.1], [1046, 0.22]]);
      else if (kind === "failure") chime(ctx, [[220, 0.25]], "square");
      else chime(ctx, [[440, 0.08]]);
    },
    [enabled],
  );

  return { enabled, toggle, play };
}

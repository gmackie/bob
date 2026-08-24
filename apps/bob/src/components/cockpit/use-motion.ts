"use client";

/**
 * Cockpit motion level — how much the wall moves.
 *   minimal   nothing animates (also the prefers-reduced-motion default)
 *   live      state-change motion only (V1 behavior)
 *   ambient   + starfield drift and translucent repo constellations
 *   spectacle + gource-style repo growth, beams on file touches, event bursts
 * Persisted like the sound toggle; one header button cycles the levels.
 */
import { useCallback, useEffect, useState } from "react";

export type MotionLevel = "minimal" | "live" | "ambient" | "spectacle";

const KEY = "cockpit.motion";
export const MOTION_ORDER: MotionLevel[] = ["minimal", "live", "ambient", "spectacle"];
export const MOTION_GLYPH: Record<MotionLevel, string> = {
  minimal: "▪",
  live: "▸",
  ambient: "≋",
  spectacle: "✦",
};

export function useCockpitMotion() {
  const [level, setLevel] = useState<MotionLevel>("live");

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as MotionLevel | null;
    if (stored && MOTION_ORDER.includes(stored)) setLevel(stored);
    else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setLevel("minimal");
  }, []);

  const cycle = useCallback(() => {
    setLevel((cur) => {
      const next = MOTION_ORDER[(MOTION_ORDER.indexOf(cur) + 1) % MOTION_ORDER.length]!;
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);

  return { level, cycle };
}

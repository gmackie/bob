/**
 * Custom arcade machinery sprites for the Floor & Agent Desks: multi-tone vector machines
 * crafted for Bob's retro-industrial brass & neon workshop palette. Every animation only
 * runs while its station holds live items or its desk has live WebSocket activity; idle
 * stations rest softly in standby. Motion level "minimal" freezes all animations.
 */
import type { CSSProperties, ReactNode } from "react";

import type { DeskMood, StationId } from "./floor-model";

export const SPRITE_KEYFRAMES = `
  @keyframes sprite-spin { to { transform: rotate(360deg) } }
  @keyframes sprite-spin-rev { to { transform: rotate(-360deg) } }
  @keyframes sprite-blink { 0%,86%,100% { transform: scaleY(1) } 92% { transform: scaleY(.12) } }
  @keyframes sprite-rumble { 0%,100% { transform: translate(0,0) } 25% { transform: translate(-.7px,.5px) } 75% { transform: translate(.7px,-.4px) } }
  @keyframes sprite-flame { 0%,100% { transform: scaleY(1) scaleX(1); opacity: .95 } 50% { transform: scaleY(1.55) scaleX(.84); opacity: .65 } }
  @keyframes sprite-wave { 0%,100% { transform: skewY(0) } 50% { transform: skewY(-10deg) } }
  @keyframes sprite-twinkle { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.22); opacity: .72 } }
  @keyframes sprite-scan { 0%,100% { transform: translate(-1.5px,-1px) } 50% { transform: translate(2px,1.5px) } }
  @keyframes sprite-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.8px) } }
  @keyframes sprite-beam { 0%,100% { opacity: .25 } 50% { opacity: .95 } }
  @keyframes sprite-typing { 0%,100% { transform: translateY(0) } 50% { transform: translateY(1.4px) } }
  @keyframes sprite-orbit { 0%,100% { opacity: .25; transform: scale(.7) } 50% { opacity: 1; transform: scale(1.25) } }
`;

const anim = (on: boolean, value: string, origin = "center"): CSSProperties | undefined =>
  on ? { animation: value, transformOrigin: origin, transformBox: "fill-box" } : undefined;

/** Warm accent tint per belt station, used for overhead stage lights and station housings. */
export const STATION_GLOW: Record<StationId, string> = {
  queue: "#b59b72",
  ready: "#d49a3a",
  admit: "#5ec8e8",
  agents: "#6fb4ff",
  ci: "#59d8f0",
  review: "#ffd27a",
  deploy: "#c09cff",
  shipped: "#7dffb0",
  scrap: "#ff6b6b",
  cancelled: "#6d5f4d",
};

function drawStation(id: StationId, on: boolean, accent: string): ReactNode {
  const metal = on ? "#e7d4b3" : "#6c5b44";
  const chassis = on ? "#2c2319" : "#1c1610";
  const dim = on ? 1 : 0.45;
  switch (id) {
    case "queue":
      return (
        <g opacity={dim}>
          {/* Pallet base */}
          <rect x="3" y="25" width="26" height="3.2" rx="1.2" fill="#6a5438" />
          <rect x="6" y="28" width="3.5" height="2" rx=".6" fill="#463725" />
          <rect x="22.5" y="28" width="3.5" height="2" rx=".6" fill="#463725" />
          {/* Stacked cargo crates */}
          <g style={anim(on, "sprite-bob 1.9s ease-in-out infinite")}>
            <rect x="5" y="17" width="11" height="8" rx="1.5" fill={accent} stroke="#17130e" strokeWidth="1" />
            <path d="M5.5 21h10" stroke="#17130e" strokeWidth=".9" opacity=".45" />
            <rect x="16" y="17" width="11" height="8" rx="1.5" fill="#a88b62" stroke="#17130e" strokeWidth="1" />
            <path d="M16.5 21h10" stroke="#17130e" strokeWidth=".9" opacity=".45" />
            <rect x="10" y="9" width="12" height="8" rx="1.5" fill="#d9b477" stroke="#17130e" strokeWidth="1" />
            <rect x="14.5" y="11" width="3" height="2" rx=".5" fill="#17130e" opacity=".55" />
          </g>
        </g>
      );
    case "ready":
      return (
        <g opacity={dim}>
          {/* Brass plinth & stanchion */}
          <rect x="6" y="26" width="10" height="3" rx="1.2" fill="#7c6340" />
          <rect x="9.5" y="5" width="2.4" height="21.5" rx="1" fill={metal} />
          <circle cx="10.7" cy="4.6" r="2.2" fill={on ? "#7dffb0" : "#5e4e39"} style={anim(on, "sprite-twinkle 1.4s ease-in-out infinite")} />
          {/* Waving checkered pennant */}
          <g style={anim(on, "sprite-wave 1.1s ease-in-out infinite", "left center")}>
            <path d="M12 6.5h15.5l-3.6 5 3.6 5H12z" fill={accent} stroke="#17130e" strokeWidth="1" />
            <rect x="14" y="8" width="3" height="3" fill="#17130e" opacity=".7" />
            <rect x="17" y="11" width="3" height="3" fill="#17130e" opacity=".7" />
            <rect x="20" y="8" width="3" height="3" fill="#17130e" opacity=".7" />
          </g>
        </g>
      );
    case "admit":
      return (
        <g opacity={dim}>
          {/* Airlock gantry pillars */}
          <rect x="4" y="9" width="4.5" height="20" rx="1.2" fill={metal} stroke="#17130e" strokeWidth="1" />
          <rect x="23.5" y="9" width="4.5" height="20" rx="1.2" fill={metal} stroke="#17130e" strokeWidth="1" />
          <rect x="3" y="6" width="26" height="4.5" rx="1.5" fill="#6a5438" stroke="#17130e" strokeWidth="1" />
          {/* Clearance beacon */}
          <circle cx="16" cy="4.2" r="2.3" fill={on ? "#6fb4ff" : "#5c4d3a"} style={anim(on, "sprite-twinkle 1s ease-in-out infinite")} />
          {/* Glowing laser curtain */}
          <rect x="9" y="13" width="14" height="2.4" rx="1.2" fill={accent} style={anim(on, "sprite-beam 1.2s ease-in-out infinite")} />
          <rect x="10.5" y="19" width="11" height="1.6" rx=".8" fill={accent} opacity=".5" style={anim(on, "sprite-bob 1.4s ease-in-out infinite")} />
        </g>
      );
    case "agents":
      return (
        <g opacity={dim}>
          {/* Antenna */}
          <rect x="15.1" y="3" width="1.8" height="4.2" fill={metal} />
          <circle cx="16" cy="2.8" r="2.1" fill={on ? "#ffd27a" : "#6c5b44"} style={anim(on, "sprite-twinkle .9s ease-in-out infinite")} />
          {/* Robot head chassis */}
          <rect x="6" y="7" width="20" height="14.5" rx="4" fill={accent} stroke="#17130e" strokeWidth="1.2" />
          {/* Ear bolts */}
          <rect x="3.5" y="12" width="2.6" height="4.8" rx="1" fill={metal} />
          <rect x="25.9" y="12" width="2.6" height="4.8" rx="1" fill={metal} />
          {/* Dark CRT visor */}
          <rect x="9" y="10" width="14" height="7.5" rx="2" fill="#0d1522" />
          {/* Expressive blinking eyes */}
          <g fill={on ? "#7dffb0" : "#5a6c82"} style={anim(on, "sprite-blink 3.1s ease-in-out infinite")}>
            <rect x="11.2" y="12" width="3.2" height="3.4" rx="1" />
            <rect x="17.6" y="12" width="3.2" height="3.4" rx="1" />
          </g>
          {/* Mini workbench / hands */}
          <rect x="8" y="22.8" width="16" height="5" rx="1.5" fill={chassis} stroke={metal} strokeWidth="1" />
          <g style={anim(on, "sprite-typing .35s ease-in-out infinite")}>
            <rect x="10.5" y="24.2" width="3.5" height="2" rx=".7" fill="#ffd27a" />
            <rect x="18" y="24.2" width="3.5" height="2" rx=".7" fill="#6fb4ff" />
          </g>
        </g>
      );
    case "ci":
      return (
        <g opacity={dim}>
          {/* Large main gear */}
          <g style={anim(on, "sprite-spin 2.8s linear infinite")}>
            <path
              d="M12.3 5h3.4l.6 2.6 2 .8 2.3-1.6 2.4 2.4-1.6 2.3.8 2 2.6.6v3.4l-2.6.6-.8 2 1.6 2.3-2.4 2.4-2.3-1.6-2 .8-.6 2.6h-3.4l-.6-2.6-2-.8-2.3 1.6L5 22.4l1.6-2.3-.8-2L3.2 17.5v-3.4l2.6-.6.8-2L5 9.2 7.4 6.8l2.3 1.6 2-.8z"
              fill={accent}
              stroke="#17130e"
              strokeWidth="1"
            />
            <circle cx="14" cy="15.8" r="4" fill="#0e1720" />
            <circle cx="14" cy="15.8" r="2" fill={on ? "#7dffb0" : "#5a6c75"} style={anim(on, "sprite-twinkle 1.2s ease-in-out infinite")} />
          </g>
          {/* Secondary counter-rotating brass pinion */}
          <g style={anim(on, "sprite-spin-rev 1.7s linear infinite")}>
            <path
              d="M23.8 17.6h2l.3 1.4 1.1.5 1.2-.9 1.4 1.4-.9 1.2.5 1.1 1.4.3v2l-1.4.3-.5 1.1.9 1.2-1.4 1.4-1.2-.9-1.1.5-.3 1.4h-2l-.3-1.4-1.1-.5-1.2.9-1.4-1.4.9-1.2-.5-1.1-1.4-.3v-2l1.4-.3.5-1.1-.9-1.2 1.4-1.4 1.2.9 1.1-.5z"
              fill="#ffd27a"
              stroke="#17130e"
              strokeWidth=".9"
            />
            <circle cx="24.8" cy="23.6" r="1.9" fill="#17130e" />
          </g>
        </g>
      );
    case "review":
      return (
        <g opacity={dim}>
          <g style={anim(on, "sprite-scan 2s ease-in-out infinite")}>
            {/* Handle */}
            <rect x="19" y="18.2" width="10.5" height="4" rx="1.8" fill="#a87932" stroke="#17130e" strokeWidth="1" transform="rotate(45 19 18.2)" />
            {/* Brass bezel */}
            <circle cx="13.5" cy="13.5" r="8.4" fill="#142029" stroke={accent} strokeWidth="2.6" />
            {/* Lens glint & scan reticle */}
            <path d="M9.5 10.5a5 5 0 0 1 5.2-1.8" fill="none" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" opacity=".65" />
            <line x1="8" y1="13.5" x2="19" y2="13.5" stroke="#7fd3e8" strokeWidth="1.2" style={anim(on, "sprite-beam 1.2s ease-in-out infinite")} />
            <circle cx="13.5" cy="13.5" r="1.8" fill={on ? "#ffd27a" : "#6c5b44"} />
          </g>
        </g>
      );
    case "deploy":
      return (
        <g opacity={dim}>
          {/* Launchpad rails */}
          <rect x="6" y="25.5" width="20" height="2.6" rx="1" fill="#5e4b34" />
          <g style={anim(on, "sprite-rumble .16s linear infinite")}>
            {/* Exhaust flame */}
            <path d="M12.5 20.5h7l-1.6 6.2L16 29l-1.9-2.3z" fill="#ff7a2f" style={anim(on, "sprite-flame .22s ease-in-out infinite", "top center")} />
            <path d="M14.2 20.5h3.6L16 26.2z" fill="#fff0a6" style={anim(on, "sprite-flame .18s ease-in-out infinite", "top center")} />
            {/* Fins */}
            <path d="M10.5 14.5 6.5 21h4zM21.5 14.5 25.5 21h-4z" fill="#d4850a" stroke="#17130e" strokeWidth=".9" />
            {/* Fuselage */}
            <path d="M16 3c4.2 3.3 5.8 8.2 5.4 17.5H10.6C10.2 11.2 11.8 6.3 16 3z" fill={accent} stroke="#17130e" strokeWidth="1.1" />
            {/* Porthole */}
            <circle cx="16" cy="11.5" r="2.6" fill="#0d1726" stroke="#ffffff" strokeWidth="1" />
            <circle cx="15.3" cy="10.8" r=".8" fill="#7fd3e8" />
          </g>
        </g>
      );
    case "shipped":
      return (
        <g opacity={dim}>
          {/* Orbiting sparkles */}
          <circle cx="6.5" cy="8" r="1.5" fill="#ffd27a" style={anim(on, "sprite-orbit 1.4s ease-in-out infinite")} />
          <circle cx="25.8" cy="10" r="1.3" fill="#7dffb0" style={anim(on, "sprite-orbit 1.6s ease-in-out .4s infinite")} />
          <circle cx="24" cy="24.5" r="1.2" fill="#ffd27a" style={anim(on, "sprite-orbit 1.5s ease-in-out .8s infinite")} />
          {/* Faceted star badge */}
          <path
            d="m16 3.5 3.6 7.5 8.2 1-6 5.6 1.6 8.1L16 21.8l-7.4 3.9 1.6-8.1-6-5.6 8.2-1z"
            fill={accent}
            stroke="#17130e"
            strokeWidth="1.1"
            style={anim(on, "sprite-twinkle 1.8s ease-in-out infinite")}
          />
          <circle cx="16" cy="15.5" r="2.2" fill="#ffffff" opacity=".65" />
        </g>
      );
    default:
      return null;
  }
}

export function StationSprite({ id, active, color, x, y }: { id: StationId; active: boolean; color: string; x: number; y: number }) {
  const glow = STATION_GLOW[id];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute flex items-center justify-center rounded-full"
      style={{
        left: x - 14,
        top: y - 14,
        width: 28,
        height: 28,
        backgroundColor: "#14100b",
        border: `1.5px solid ${active ? color : "#3a2f22"}`,
        boxShadow: active ? `0 0 14px ${glow}55, inset 0 0 8px ${glow}26` : "inset 0 1px 2px #00000099",
      }}
    >
      <svg width={21} height={21} viewBox="0 0 32 32" style={{ overflow: "visible" }}>
        {drawStation(id, active, color)}
      </svg>
    </div>
  );
}

/** Mini custom vector icons for the Failed (scrap crusher) and Cancelled (archive tray) bins. */
export function BinIcon({ id, active }: { id: "scrap" | "cancelled"; active: boolean }) {
  if (id === "scrap") {
    return (
      <svg aria-hidden width={14} height={14} viewBox="0 0 16 16" className="inline-block align-[-2px]">
        <rect x="2" y="4" width="12" height="10" rx="1.5" fill={active ? "#3b1717" : "#221b14"} stroke={active ? "#ff6b6b" : "#6a5638"} strokeWidth="1.2" />
        <path d="M4.5 7l7 4M11.5 7l-7 4" stroke={active ? "#ff6b6b" : "#6a5638"} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8" cy="2.3" r="1.4" fill={active ? "#ff6b6b" : "#5a4a36"} style={anim(active, "sprite-twinkle .9s ease-in-out infinite")} />
      </svg>
    );
  }
  return (
    <svg aria-hidden width={14} height={14} viewBox="0 0 16 16" className="inline-block align-[-2px]">
      <rect x="2" y="5" width="12" height="9" rx="1.5" fill="#1e1812" stroke={active ? "#a8987e" : "#5c4c38"} strokeWidth="1.2" />
      <rect x="1.5" y="2.5" width="13" height="2.6" rx=".8" fill={active ? "#70604c" : "#3a2f22"} />
      <rect x="6" y="8" width="4" height="1.5" rx=".6" fill={active ? "#cdbfa6" : "#6a5638"} />
    </svg>
  );
}

/** Expressive mini agent robot bust for Desk cards, reacting live to WebSocket mood. */
export function AgentAvatarSvg({ mood, hue }: { mood: DeskMood; hue: number }) {
  const active = mood !== "idle" && mood !== "stalled";
  const body =
    mood === "asking"
      ? "#ffd27a"
      : mood === "ci-failed"
        ? "#ff6b6b"
        : mood === "ci-green"
          ? "#7dffb0"
          : mood === "shipping"
            ? "#b9a2ff"
            : mood === "testing" || mood === "ci-running"
              ? "#6fb4ff"
              : `hsl(${hue} 60% 56%)`;
  const eyeColor =
    mood === "asking"
      ? "#ffd27a"
      : mood === "ci-failed"
        ? "#ff6b6b"
        : mood === "ci-green"
          ? "#7dffb0"
          : mood === "stalled"
            ? "#ff9f43"
            : "#7fd3e8";

  return (
    <svg aria-hidden width={26} height={26} viewBox="0 0 28 28" className="shrink-0" style={{ overflow: "visible" }}>
      <g style={anim(mood === "coding" || mood === "testing" || mood === "building", "sprite-bob .9s ease-in-out infinite")}>
        {/* Antenna */}
        <line x1="14" y1="6.5" x2="14" y2="3" stroke="#bba47e" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="14" cy="2.6" r="2" fill={eyeColor} style={anim(active, "sprite-twinkle .9s ease-in-out infinite")} />
        {/* Head */}
        <rect x="4" y="6.5" width="20" height="15" rx="4.5" fill="#231c15" stroke={body} strokeWidth="1.6" />
        {/* Visor */}
        <rect x="7" y="9.5" width="14" height="8" rx="2.2" fill="#0a0e14" />
        {/* Eyes / expression by mood */}
        {mood === "ci-failed" ? (
          <g stroke={eyeColor} strokeWidth="1.7" strokeLinecap="round">
            <path d="M9.5 12l2.6 2.6M12.1 12l-2.6 2.6M15.9 12l2.6 2.6M18.5 12l-2.6 2.6" />
          </g>
        ) : mood === "ci-green" || mood === "shipping" ? (
          <g fill="none" stroke={eyeColor} strokeWidth="1.8" strokeLinecap="round">
            <path d="M9.4 14.2c.8-1.6 2.2-1.6 3 0" />
            <path d="M15.6 14.2c.8-1.6 2.2-1.6 3 0" />
          </g>
        ) : mood === "asking" ? (
          <g fill={eyeColor} style={anim(true, "sprite-twinkle .8s ease-in-out infinite")}>
            <circle cx="11" cy="13.5" r="1.8" />
            <circle cx="17" cy="13.5" r="1.8" />
          </g>
        ) : (
          <g fill={eyeColor} style={anim(active, "sprite-blink 2.8s ease-in-out infinite")}>
            <rect x="9.5" y="11.8" width="3" height="3.4" rx="1" />
            <rect x="15.5" y="11.8" width="3" height="3.4" rx="1" />
          </g>
        )}
        {/* Little shoulders / keyboard */}
        <rect x="7.5" y="22.8" width="13" height="3.2" rx="1.4" fill={body} opacity={active ? 0.9 : 0.4} />
      </g>
    </svg>
  );
}

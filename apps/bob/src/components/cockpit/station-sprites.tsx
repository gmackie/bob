/**
 * Station sprites for the Floor (BOB-91 slice 3): one small pixel-ish SVG per belt station,
 * drawn in currentColor. A sprite only animates while its station holds items (the gear
 * turns while something is in CI, the rocket rumbles while something deploys), so the
 * motion always reflects live state. Motion level "minimal" stops it with the rest.
 */
import type { CSSProperties, ReactNode } from "react";

import type { StationId } from "./floor-model";

export const SPRITE_KEYFRAMES = `
  @keyframes sprite-spin { to { transform: rotate(360deg) } }
  @keyframes sprite-blink { 0%,90%,100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }
  @keyframes sprite-rumble { 0%,100% { transform: translate(0,0) } 25% { transform: translate(-.6px,.4px) } 75% { transform: translate(.6px,-.4px) } }
  @keyframes sprite-flame { 0%,100% { transform: scaleY(1); opacity: .9 } 50% { transform: scaleY(1.5); opacity: .6 } }
  @keyframes sprite-wave { 0%,100% { transform: skewY(0) } 50% { transform: skewY(-8deg) } }
  @keyframes sprite-twinkle { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.18); opacity: .75 } }
  @keyframes sprite-scan { 0%,100% { transform: translate(0,0) } 50% { transform: translate(2px,1px) } }
  @keyframes sprite-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.5px) } }
`;

const anim = (on: boolean, value: string, origin = "center"): CSSProperties | undefined =>
  on ? { animation: value, transformOrigin: origin, transformBox: "fill-box" } : undefined;

function draw(id: StationId, on: boolean): ReactNode {
  switch (id) {
    case "queue":
      return (
        <g style={anim(on, "sprite-bob 1.6s ease-in-out infinite")}>
          <rect x="4" y="12" width="14" height="6" rx="1" />
          <rect x="6" y="7" width="10" height="5" rx="1" opacity=".7" />
          <rect x="8" y="3" width="6" height="4" rx="1" opacity=".45" />
        </g>
      );
    case "ready":
      return (
        <>
          <rect x="5" y="3" width="1.6" height="16" />
          <path d="M6.6 4h10l-2.5 3.5 2.5 3.5h-10z" style={anim(on, "sprite-wave 1s ease-in-out infinite", "left center")} />
        </>
      );
    case "admit":
      return (
        <>
          <rect x="3" y="6" width="2" height="13" />
          <rect x="17" y="6" width="2" height="13" />
          <rect x="5" y="9" width="12" height="2" style={anim(on, "sprite-bob 1.2s ease-in-out infinite")} />
          <circle cx="11" cy="4.5" r="1.6" opacity=".7" />
        </>
      );
    case "agents":
      return (
        <>
          <rect x="10.2" y="1.5" width="1.6" height="3" />
          <circle cx="11" cy="1.8" r="1.3" style={anim(on, "sprite-twinkle .8s ease-in-out infinite")} />
          <rect x="4" y="5" width="14" height="11" rx="3" />
          <g fill="#17130e" style={anim(on, "sprite-blink 3s ease-in-out infinite")}>
            <rect x="7" y="8.5" width="2.4" height="2.8" rx=".6" />
            <rect x="12.6" y="8.5" width="2.4" height="2.8" rx=".6" />
          </g>
          <rect x="8" y="13" width="6" height="1.2" fill="#17130e" />
          <rect x="6" y="17" width="10" height="3" rx="1" opacity=".7" />
        </>
      );
    case "ci":
      return (
        <g style={anim(on, "sprite-spin 2.4s linear infinite")}>
          <path d="M9.6 2h2.8l.5 2.4 1.7.7 2-1.4 2 2-1.4 2 .7 1.7 2.4.5v2.8l-2.4.5-.7 1.7 1.4 2-2 2-2-1.4-1.7.7-.5 2.4H9.6l-.5-2.4-1.7-.7-2 1.4-2-2 1.4-2-.7-1.7L1.7 12.4V9.6l2.4-.5.7-1.7-1.4-2 2-2 2 1.4 1.7-.7z" />
          <circle cx="11" cy="11" r="3" fill="#17130e" />
        </g>
      );
    case "review":
      return (
        <g style={anim(on, "sprite-scan 1.8s ease-in-out infinite")}>
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <rect x="13" y="13.2" width="7" height="2.6" rx="1" transform="rotate(45 13 13.2)" />
        </g>
      );
    case "deploy":
      return (
        <g style={anim(on, "sprite-rumble .18s linear infinite")}>
          <path d="M11 1.5c3 2.5 4.2 6 4 10.5H7C6.8 7.5 8 4 11 1.5z" />
          <circle cx="11" cy="7" r="1.5" fill="#17130e" />
          <path d="M7 9.5 4 14h3zM15 9.5l3 4.5h-3z" opacity=".75" />
          <path d="M8.5 13h5l-1 3h-3z" fill="#ff8a3d" style={anim(on, "sprite-flame .25s ease-in-out infinite", "top center")} />
        </g>
      );
    case "shipped":
      return <path d="m11 2 2.6 5.6 6 .7-4.5 4.1 1.2 6L11 15.4l-5.3 3 1.2-6-4.5-4.1 6-.7z" style={anim(on, "sprite-twinkle 1.6s ease-in-out infinite")} />;
    default:
      return null;
  }
}

export function StationSprite({ id, active, color, x, y }: { id: StationId; active: boolean; color: string; x: number; y: number }) {
  return (
    <svg aria-hidden width={22} height={22} viewBox="0 0 22 22" className="absolute" style={{ left: x - 11, top: y - 11, color, fill: "currentColor", overflow: "visible" }}>
      {draw(id, active)}
    </svg>
  );
}

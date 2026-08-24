"use client";

/**
 * Spectacle layer — one full-screen canvas behind the wall. Three ingredients,
 * gated by motion level:
 *   ambient    starfield drift + translucent repo constellations
 *   spectacle  + gource-style growth (agent-colored beams fly to freshly
 *              touched files), node labels while hot, and particle bursts on
 *              merge / deploy / failure / PR timeline events.
 * Data comes from what the wall already has: session file_changes feeds and
 * the timeline diff the page runs for sound. No new transport, no deps —
 * plain canvas 2D on requestAnimationFrame, idle when the level is below
 * ambient. Everything mutable lives in refs so a feed burst never re-renders
 * React; the canvas samples the live feed map each frame.
 */
import { useEffect, useRef } from "react";

import { buildRepoLayout, touchFingerprints, type RepoNode } from "./spectacle-model";

import type { MotionLevel } from "./use-motion";
import type { CockpitSession, TileFeed } from "./use-cockpit";

export type BurstKind = "merge" | "deploy" | "failure" | "pr";

const AGENT_COLOR: Record<string, string> = {
  claude: "#e07a4f",
  codex: "#6fb4ff",
  grok: "#c39bff",
  cursor: "#38e1b0",
};
const BURST_COLOR: Record<BurstKind, string> = {
  merge: "#38e1b0",
  deploy: "#6fb4ff",
  failure: "#f87171",
  pr: "#9fb3d8",
};

interface Star {
  x: number;
  y: number;
  z: number; // 0..1 — parallax depth
}
interface Beam {
  sessionId: string;
  toPath: string;
  t: number;
  color: string;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  ttl: number;
  size: number;
  color: string;
  gravity: number;
}
interface Cluster {
  layout: Map<string, RepoNode>;
  pathsKey: string;
  fingerprints: Map<string, number>;
  heat: Map<string, number>;
}

export function SpectacleLayer({
  level,
  sessions,
  feeds,
  burstQueueRef,
}: {
  level: MotionLevel;
  sessions: CockpitSession[];
  feeds: Map<string, TileFeed>;
  burstQueueRef: React.MutableRefObject<BurstKind[]>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The rAF loop reads live props through this ref instead of re-binding.
  const propsRef = useRef({ level, sessions, feeds });
  propsRef.current = { level, sessions, feeds };

  const active = level === "ambient" || level === "spectacle";

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stars: Star[] = Array.from({ length: 140 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
    }));
    const clusters = new Map<string, Cluster>();
    let beams: Beam[] = [];
    let particles: Particle[] = [];

    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const spawnBurst = (kind: BurstKind, w: number, h: number) => {
      const color = BURST_COLOR[kind];
      const n = kind === "pr" ? 14 : kind === "deploy" ? 46 : 36;
      const cx = w * (0.3 + Math.random() * 0.4);
      const cy = kind === "deploy" ? h * 0.9 : h * (0.3 + Math.random() * 0.3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = kind === "deploy" ? 60 + Math.random() * 120 : 40 + Math.random() * 160;
        particles.push({
          x: cx,
          y: cy,
          vx: kind === "deploy" ? (Math.random() - 0.5) * 60 : Math.cos(a) * speed,
          vy: kind === "deploy" ? -speed * 2 : Math.sin(a) * speed,
          life: 0,
          ttl: kind === "pr" ? 0.7 : 1.4 + Math.random() * 0.8,
          size: kind === "pr" ? 1.5 : 1.5 + Math.random() * 2.5,
          color,
          gravity: kind === "deploy" ? 30 : kind === "failure" ? 160 : 90,
        });
        particles[particles.length - 1]!.life = particles[particles.length - 1]!.ttl;
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { level: lvl, sessions: live, feeds: feedMap } = propsRef.current;
      const spectacle = lvl === "spectacle";
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;

      // ---- ingest: bursts queued by the page's timeline diff (spectacle only)
      if (burstQueueRef.current.length) {
        if (spectacle) for (const kind of burstQueueRef.current) spawnBurst(kind, w, h);
        burstQueueRef.current = [];
      }

      // ---- ingest: file_changes feeds → layouts, heat, beams
      const liveIds = new Set(live.map((s) => s.id));
      for (const id of clusters.keys()) if (!liveIds.has(id)) clusters.delete(id);
      for (const s of live) {
        const files = feedMap.get(s.id)?.files;
        if (!files) continue;
        const paths = [...new Set([...files.touched, ...files.topFiles.map((f) => f.path)])];
        const pathsKey = paths.join("\n");
        let cluster = clusters.get(s.id);
        if (!cluster) {
          cluster = { layout: new Map(), pathsKey: "", fingerprints: new Map(), heat: new Map() };
          clusters.set(s.id, cluster);
        }
        if (cluster.pathsKey !== pathsKey) {
          cluster.layout = buildRepoLayout(paths);
          cluster.pathsKey = pathsKey;
        }
        const fps = touchFingerprints(files.topFiles);
        for (const [path, fp] of fps) {
          if (cluster.fingerprints.get(path) !== fp && cluster.layout.has(path)) {
            cluster.heat.set(path, 1);
            if (spectacle) beams.push({ sessionId: s.id, toPath: path, t: 0, color: AGENT_COLOR[s.agent] ?? "#8b97b3" });
          }
        }
        cluster.fingerprints = fps;
        const decay = Math.exp(-dt / 12);
        for (const [path, heat] of cluster.heat) {
          const next = heat * decay;
          if (next < 0.02) cluster.heat.delete(path);
          else cluster.heat.set(path, next);
        }
      }

      // ---- draw
      ctx.clearRect(0, 0, w, h);
      const dim = spectacle ? 1 : 0.45;

      for (const st of stars) {
        st.x = (st.x + dt * 0.004 * st.z) % 1;
        st.y = (st.y - dt * 0.0015 * st.z + 1) % 1;
        ctx.globalAlpha = 0.05 + st.z * 0.14 * dim;
        ctx.fillStyle = "#cdd8ef";
        ctx.fillRect(st.x * w, st.y * h, st.z > 0.75 ? 2 : 1, st.z > 0.75 ? 2 : 1);
      }

      const shown = live.filter((s) => clusters.get(s.id)?.layout.size);
      shown.forEach((s, i) => {
        const cluster = clusters.get(s.id)!;
        const cx = w * ((i + 0.5) / shown.length);
        const cy = h * 0.44;
        const radius = Math.min((w / shown.length) * 0.42, h * 0.3);
        const color = AGENT_COLOR[s.agent] ?? "#8b97b3";
        const px = (n: RepoNode) => cx + n.x * radius;
        const py = (n: RepoNode) => cy + n.y * radius;

        ctx.lineWidth = 1;
        for (const node of cluster.layout.values()) {
          if (node.parent == null) continue;
          const parent = cluster.layout.get(node.parent);
          if (!parent) continue;
          ctx.globalAlpha = 0.05 * dim;
          ctx.strokeStyle = "#ffffff";
          ctx.beginPath();
          ctx.moveTo(px(parent), py(parent));
          ctx.lineTo(px(node), py(node));
          ctx.stroke();
        }
        for (const node of cluster.layout.values()) {
          const heat = cluster.heat.get(node.path) ?? 0;
          if (!node.isFile) {
            if (node.depth === 0) continue;
            ctx.globalAlpha = 0.12 * dim;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(px(node), py(node), 1.5, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.globalAlpha = (0.14 + heat * 0.86) * dim;
          ctx.fillStyle = heat > 0.03 ? color : "#aab6cf";
          ctx.beginPath();
          ctx.arc(px(node), py(node), 2 + heat * 3.5, 0, Math.PI * 2);
          ctx.fill();
          if (spectacle && heat > 0.45) {
            ctx.globalAlpha = heat * 0.8;
            ctx.font = "10px ui-monospace, monospace";
            ctx.fillText(node.name, px(node) + 6, py(node) + 3);
          }
        }
        if (spectacle) {
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = color;
          ctx.font = "11px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`${s.agent} · ${s.repo ?? ""}`, cx, cy + radius + 18);
          ctx.textAlign = "start";
        }
      });

      beams = beams.filter((b) => {
        const idx = shown.findIndex((s) => s.id === b.sessionId);
        const cluster = clusters.get(b.sessionId);
        const node = cluster?.layout.get(b.toPath);
        if (idx === -1 || !node) return false;
        b.t += dt * 1.6;
        if (b.t >= 1) return false;
        const cx = w * ((idx + 0.5) / shown.length);
        const cy = h * 0.44;
        const radius = Math.min((w / shown.length) * 0.42, h * 0.3);
        const x = cx + node.x * radius * b.t;
        const y = cy + node.y * radius * b.t;
        ctx.globalAlpha = 0.9 * (1 - b.t * 0.4);
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        return true;
      });

      particles = particles.filter((p) => {
        p.life -= dt;
        if (p.life <= 0) return false;
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.max(0, p.life / p.ttl) * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });

      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [active, burstQueueRef]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

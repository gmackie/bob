import { inScope, RELEASE_STAGE_PRESENTATION, repoKey, rows, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { Attention, EdgeView, ItemState, Row, Scope } from "@bob/sdlc-view";

/**
 * The Floor (BOB-91): the SDLC as a factory line. Each Kanbanger issue is a parcel riding
 * a belt of stations; failed and cancelled items drop into bins under the line.
 *
 * This file is layout only, with no rendering: it turns an edge view and a box into
 * positioned stations and parcels. Web (DOM) and native (React Native views) draw the
 * same scene and animate a parcel when its position changes, so every move on screen is
 * a real state change.
 */
export type StationId = "queue" | "ready" | "admit" | "agents" | "ci" | "review" | "deploy" | "shipped" | "scrap" | "cancelled";

export interface FloorStation {
  id: StationId;
  label: string;
  /** Item states parked at this station. Every ItemState belongs to exactly one station. */
  states: readonly ItemState[];
  kind: "belt" | "bin";
}

export const FLOOR_STATIONS: readonly FloorStation[] = [
  { id: "queue", label: "Queue", states: ["pending"], kind: "belt" },
  { id: "ready", label: "Ready", states: ["ready"], kind: "belt" },
  { id: "admit", label: "Admit", states: ["reserved", "execution-unknown"], kind: "belt" },
  { id: "agents", label: "Agents", states: ["running", "waiting-input"], kind: "belt" },
  { id: "ci", label: "CI", states: ["validating"], kind: "belt" },
  { id: "review", label: "Review", states: ["review"], kind: "belt" },
  { id: "deploy", label: "Deploy", states: ["deploying"], kind: "belt" },
  { id: "shipped", label: "Shipped", states: ["completed"], kind: "belt" },
  { id: "scrap", label: "Failed", states: ["failed"], kind: "bin" },
  { id: "cancelled", label: "Cancelled", states: ["cancelling", "cancelled"], kind: "bin" },
];

const STATION_OF = new Map<ItemState, StationId>(FLOOR_STATIONS.flatMap((s) => s.states.map((state) => [state, s.id] as const)));
export const stationFor = (state: ItemState): StationId => STATION_OF.get(state)!;

export type Orientation = "wide" | "tall";
export type Marker = "!" | "✕" | "?" | null;

export interface FloorStationNode {
  id: StationId;
  label: string;
  kind: "belt" | "bin";
  /** Center of the station marker (belt) or the bin's top-left label anchor (bin). */
  x: number;
  y: number;
  count: number;
  /** The worst attention among the station's items, or null when it is empty. */
  attention: Attention | null;
}

export interface FloorParcel {
  itemId: string;
  /** The tracker identifier (BOB-91), else the issue id. */
  label: string;
  stationId: StationId;
  state: ItemState;
  stateLabel: string;
  /** The release stage label (BOB-82), when the item has a release. */
  release: string | null;
  attention: Attention;
  marker: Marker;
  /** A stable hue per repository, so one repo's parcels read as a family. */
  hue: number;
  repo: string;
  /** Center position. */
  x: number;
  y: number;
  accessibilityLabel: string;
}

export interface FloorOverflow { stationId: StationId; count: number; x: number; y: number }

export interface FloorScene {
  orientation: Orientation;
  width: number;
  height: number;
  parcel: { w: number; h: number };
  /** The belt's center line. */
  belt: { x1: number; y1: number; x2: number; y2: number };
  stations: FloorStationNode[];
  parcels: FloorParcel[];
  overflow: FloorOverflow[];
}

export interface FloorOptions {
  /** Default: wide when the box is wider than tall. */
  orientation?: Orientation;
  scope?: Scope;
}

const ATTENTION_RANK: Record<Attention, number> = { needs_human: 0, failed: 1, stalled: 2, ok: 3 };
const MARKER: Record<Attention, Marker> = { needs_human: "!", failed: "✕", stalled: "?", ok: null };
const PAD = 12;
const GAP = 6;
const BIN_BAND = 52;

export function hueFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

const label = (row: Row) => row.issue.identifier ?? row.issue.issueId;

function parcelFor(row: Row): Omit<FloorParcel, "x" | "y"> {
  const stationId = stationFor(row.item.state);
  const stateLabel = STATE_PRESENTATION[row.item.state].label;
  const release = row.item.release ? RELEASE_STAGE_PRESENTATION[row.item.release.stage].label : null;
  const attention = row.attention;
  const repo = row.target.repository.repositoryId;
  const needs = attention === "needs_human" ? ", needs you" : attention === "failed" ? ", failed" : attention === "stalled" ? ", stalled" : "";
  return {
    itemId: row.item.itemId,
    label: label(row),
    stationId,
    state: row.item.state,
    stateLabel,
    release,
    attention,
    marker: MARKER[attention],
    hue: hueFor(repoKey(row.target.repository)),
    repo,
    accessibilityLabel: `${label(row)}, ${repo}, ${stateLabel}${release ? `, ${release}` : ""}${needs}`,
  };
}

/** Attention first, then label, then id: the same view always stacks the same way. */
const byAttention = (a: Omit<FloorParcel, "x" | "y">, b: Omit<FloorParcel, "x" | "y">) =>
  ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention] || a.label.localeCompare(b.label) || a.itemId.localeCompare(b.itemId);

export function floorScene(view: EdgeView, box: { width: number; height: number }, options: FloorOptions = {}): FloorScene {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const orientation: Orientation = options.orientation ?? (width >= height ? "wide" : "tall");
  const scope = options.scope ?? {};
  const all = rows(view).filter((r) => inScope(r, scope)).map(parcelFor);

  const byStation = new Map<StationId, Omit<FloorParcel, "x" | "y">[]>(FLOOR_STATIONS.map((s) => [s.id, []]));
  for (const p of all) byStation.get(p.stationId)!.push(p);
  for (const list of byStation.values()) list.sort(byAttention);

  const belt = FLOOR_STATIONS.filter((s) => s.kind === "belt");
  const bins = FLOOR_STATIONS.filter((s) => s.kind === "bin");
  const parcel = orientation === "wide" ? { w: 64, h: 24 } : { w: 66, h: 24 };
  const stations: FloorStationNode[] = [];
  const parcels: FloorParcel[] = [];
  const overflow: FloorOverflow[] = [];
  const worst = (list: Omit<FloorParcel, "x" | "y">[]) => (list.length ? list[0]!.attention : null);

  const place = (id: StationId, slots: { x: number; y: number }[]) => {
    const list = byStation.get(id)!;
    const room = Math.max(1, slots.length);
    const shown = list.length > room ? room - 1 : list.length;
    list.slice(0, shown).forEach((p, i) => parcels.push({ ...p, ...slots[i]! }));
    if (list.length > shown) overflow.push({ stationId: id, count: list.length - shown, ...slots[shown]! });
  };

  const beltBottom = height - BIN_BAND;
  let beltLine: FloorScene["belt"];

  if (orientation === "wide") {
    const colW = (width - PAD * 2) / belt.length;
    const beltY = PAD + 30;
    beltLine = { x1: PAD, y1: beltY, x2: width - PAD, y2: beltY };
    const firstY = beltY + 14 + parcel.h / 2;
    const rowsFit = Math.max(1, Math.floor((beltBottom - firstY + parcel.h / 2) / (parcel.h + GAP)));
    belt.forEach((s, i) => {
      const x = PAD + colW * (i + 0.5);
      const list = byStation.get(s.id)!;
      stations.push({ id: s.id, label: s.label, kind: "belt", x, y: beltY, count: list.length, attention: worst(list) });
      place(s.id, Array.from({ length: rowsFit }, (_, r) => ({ x, y: firstY + r * (parcel.h + GAP) })));
    });
  } else {
    const labelW = 74;
    const rowH = (beltBottom - PAD) / belt.length;
    const beltX = PAD + labelW;
    beltLine = { x1: beltX, y1: PAD, x2: beltX, y2: beltBottom };
    const firstX = beltX + 14 + parcel.w / 2;
    const colsFit = Math.max(1, Math.floor((width - PAD - firstX + parcel.w / 2) / (parcel.w + GAP)));
    belt.forEach((s, i) => {
      const y = PAD + rowH * (i + 0.5);
      const list = byStation.get(s.id)!;
      stations.push({ id: s.id, label: s.label, kind: "belt", x: beltX, y, count: list.length, attention: worst(list) });
      place(s.id, Array.from({ length: colsFit }, (_, c) => ({ x: firstX + c * (parcel.w + GAP), y })));
    });
  }

  // Bins share the band under the belt, each taking half of it.
  const binW = (width - PAD * 2) / bins.length;
  const binY = beltBottom + 8;
  bins.forEach((s, i) => {
    const x0 = PAD + binW * i;
    const list = byStation.get(s.id)!;
    stations.push({ id: s.id, label: s.label, kind: "bin", x: x0, y: binY, count: list.length, attention: worst(list) });
    const startX = x0 + parcel.w / 2;
    const fit = Math.max(1, Math.floor((binW - GAP) / (parcel.w + GAP)));
    place(s.id, Array.from({ length: fit }, (_, c) => ({ x: startX + c * (parcel.w + GAP), y: binY + 16 + parcel.h / 2 })));
  });

  return { orientation, width, height, parcel, belt: beltLine, stations, parcels, overflow };
}

/** The scene as text, one line per non-empty station: the screen-reader view of the floor. */
export function floorSummary(scene: FloorScene): string[] {
  return scene.stations
    .filter((s) => s.count > 0)
    .map((s) => {
      const items = scene.parcels.filter((p) => p.stationId === s.id).map((p) => (p.marker ? `${p.label} (${p.attention.replace("_", " ")})` : p.label));
      const more = scene.overflow.find((o) => o.stationId === s.id);
      return `${s.label}: ${items.join(", ")}${more ? `, and ${more.count} more` : ""}`;
    });
}

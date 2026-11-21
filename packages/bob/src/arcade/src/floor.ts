import { coordinatedIssueIds, inScope, issueAttention, issueStation, RELEASE_STAGE_PRESENTATION, repoKey, rows, stateAge, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { Attention, EdgeView, IssueStation, ItemState, Row, Scope, TrackedIssue } from "@bob/sdlc-view";

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

/**
 * What a parcel's colour says (BOB-101): where the work is, not which repository it is
 * from. One repository used to paint every parcel the same pink, which read as "failed".
 * Only scrap is red.
 */
export type ParcelTone = "queued" | "agents" | "ci" | "review" | "deploy" | "shipped" | "failed" | "cancelled";
const TONE_OF: Record<StationId, ParcelTone> = {
  queue: "queued",
  ready: "queued",
  admit: "agents",
  agents: "agents",
  ci: "ci",
  review: "review",
  deploy: "deploy",
  shipped: "shipped",
  scrap: "failed",
  cancelled: "cancelled",
};
/** Fill and text colour per tone, readable on the dark stage. Web and native share it. */
export const PARCEL_TONE: Record<ParcelTone, { fill: string; ink: string }> = {
  queued: { fill: "#8a7758", ink: "#17130e" },
  agents: { fill: "#6fb4ff", ink: "#0b1726" },
  ci: { fill: "#7fd3e8", ink: "#0b1a1f" },
  review: { fill: "#ffd27a", ink: "#17130e" },
  deploy: { fill: "#b9a2ff", ink: "#140f26" },
  shipped: { fill: "#7dffb0", ink: "#0b1f13" },
  failed: { fill: "#ff6b6b", ink: "#1f0b0b" },
  cancelled: { fill: "#3d342a", ink: "#cdbfa6" },
};

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
  /** A coordinator item, or a tracked Kanbanger issue no coordinator item draws (BOB-99). */
  kind: "item" | "issue";
  /** The item id, or for an issue its Kanbanger UUID: unique on the floor either way. */
  itemId: string;
  /** The Kanbanger issue UUID for an issue parcel, else null. */
  issueId: string | null;
  /** The tracker identifier (BOB-91), else the issue id. */
  label: string;
  /** Tells apart parcels that share a label (the item name), else null. */
  sublabel: string | null;
  /** How long the item has been in its state ("40m", "5h", "9d"), or null when unknown. */
  age: string | null;
  stationId: StationId;
  /** The coordinator item state; null for an issue parcel (see stateLabel). */
  state: ItemState | null;
  /** The item state's label, or the issue's Kanbanger state name. */
  stateLabel: string;
  /** The release stage label (BOB-82), when the item has a release. */
  release: string | null;
  attention: Attention;
  marker: Marker;
  tone: ParcelTone;
  /** A stable hue per repository, drawn as a thin stripe so one repo's parcels read as a family. */
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
  /** Backlog and triage issues in scope: counted, never drawn on the belt (BOB-99). */
  backlog: number;
}

export interface FloorOptions {
  /** Only this Kanbanger project's issues and the coordinator items whose plan issue is in it (BOB-99). */
  projectId?: string;
  /** Default: wide when the box is at least WIDE_MIN_WIDTH across (iPad, landscape phone, web). */
  orientation?: Orientation;
  scope?: Scope;
  /** The clock for ages and stalls (BOB-101). Without it parcels show no age and never stall. */
  now?: number;
}

/** A belt of 8 stations needs about this much width before columns beat rows (iPad portrait qualifies). */
export const WIDE_MIN_WIDTH = 560;

const ATTENTION_RANK: Record<Attention, number> = { needs_human: 0, failed: 1, stalled: 2, ok: 3 };
const MARKER: Record<Attention, Marker> = { needs_human: "!", failed: "✕", stalled: "?", ok: null };
const PAD = 12;
const GAP = 6;
/** Parcels carry two lines (label, then item name and age). */
const PARCEL_H = 34;
/** A tall floor's empty station is a thin labelled row, not an equal share of the height. */
const EMPTY_ROW = 22;
/** Room above and below a tall station's parcels. */
const STATION_PAD = 5;
/** Bins hold up to this many parcel rows; past that a counter takes the last slot. */
const BIN_ROWS_MAX = 2;
const BIN_BAND_EMPTY = 26;
const SUBLABEL_MAX = 12;

export function hueFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/** "40m", "5h", "9d": a parcel has room for three characters. */
export function shortAge(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const label = (row: Row) => row.issue.identifier ?? row.issue.issueId;
const clip = (text: string, max = SUBLABEL_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** A parcel's second line fits about 14 characters with the age beside it. */
const TITLE_SUBLABEL_MAX = 14;
const ISSUE_STATION: Record<Exclude<IssueStation, "backlog">, StationId> = {
  queue: "queue", agents: "agents", ci: "ci", review: "review", deploy: "deploy", shipped: "shipped", scrap: "scrap", cancelled: "cancelled",
};
/** The repository an issue's parcel stripe stands for: its PR's repo, else its project. */
const issueFamily = (issue: TrackedIssue) => issue.pr?.repo ?? issue.project?.name ?? issue.team ?? "kanbanger";

type Placed = Omit<FloorParcel, "x" | "y">;

function parcelFor(row: Row, now: number | undefined): Placed {
  const stationId = stationFor(row.item.state);
  const stateLabel = STATE_PRESENTATION[row.item.state].label;
  const release = row.item.release ? RELEASE_STAGE_PRESENTATION[row.item.release.stage].label : null;
  const attention = row.attention;
  const repo = row.target.repository.repositoryId;
  const ageMs = now === undefined ? null : stateAge(row.item, now);
  const age = ageMs === null ? null : shortAge(ageMs);
  const needs = attention === "needs_human" ? ", needs you" : attention === "failed" ? ", failed" : attention === "stalled" ? ", stalled" : "";
  return {
    kind: "item",
    itemId: row.item.itemId,
    issueId: null,
    label: label(row),
    sublabel: null,
    age,
    stationId,
    state: row.item.state,
    stateLabel,
    release,
    attention,
    marker: MARKER[attention],
    tone: TONE_OF[stationId],
    hue: hueFor(repoKey(row.target.repository)),
    repo,
    accessibilityLabel: `${label(row)}, ${repo}, ${stateLabel}${release ? `, ${release}` : ""}${age ? `, for ${age}` : ""}${needs}`,
  };
}

function issueParcelFor(issue: TrackedIssue, stationId: StationId, now: number | undefined): Placed {
  const attention = issueAttention(issue, now);
  const age = now === undefined ? null : shortAge(Math.max(0, now - issue.updatedAt));
  const repo = issueFamily(issue);
  const pr = issue.pr ? `, PR #${issue.pr.number} ${issue.pr.state}${issue.pr.checks ? ` checks ${issue.pr.checks}` : ""}` : "";
  const needs = attention === "failed" ? ", failed" : attention === "stalled" ? ", stalled" : "";
  return {
    kind: "issue",
    itemId: issue.id,
    issueId: issue.id,
    label: issue.key,
    sublabel: clip(issue.title, TITLE_SUBLABEL_MAX),
    age,
    stationId,
    state: null,
    stateLabel: issue.state.name,
    release: null,
    attention,
    marker: MARKER[attention],
    tone: TONE_OF[stationId],
    hue: hueFor(repo),
    repo,
    accessibilityLabel: `${issue.key}, ${issue.title}, ${issue.project?.name ?? repo}, ${issue.state.name}${pr}${age ? `, untouched for ${age}` : ""}${needs}`,
  };
}

/**
 * Tracked issues in scope that no coordinator item draws, split into drawn parcels and the
 * backlog count. `projectId` narrows to one Kanbanger project.
 */
function issueParcels(view: EdgeView, itemRows: Row[], projectId: string | undefined, now: number | undefined): { parcels: Placed[]; backlog: number } {
  const coordinated = coordinatedIssueIds(itemRows);
  const parcels: Placed[] = [];
  let backlog = 0;
  for (const issue of Object.values(view.issues ?? {})) {
    if (coordinated.has(issue.id)) continue;
    if (projectId !== undefined && issue.project?.id !== projectId) continue;
    const station = issueStation(issue);
    if (station === "backlog") { backlog++; continue; }
    parcels.push(issueParcelFor(issue, ISSUE_STATION[station], now));
  }
  return { parcels, backlog };
}

/** Parcels that share a label (two attempts at one issue) show their item name under it. */
function disambiguate(all: Placed[]): void {
  const seen = new Map<string, number>();
  for (const p of all) if (p.kind === "item") seen.set(p.label, (seen.get(p.label) ?? 0) + 1);
  for (const p of all) {
    if (p.kind !== "item" || (seen.get(p.label) ?? 0) < 2) continue;
    p.sublabel = clip(p.itemId);
    p.accessibilityLabel = `${p.label} (${p.itemId})${p.accessibilityLabel.slice(p.label.length)}`;
  }
}

/** Attention first, then label, then id: the same view always stacks the same way. */
const byAttention = (a: Placed, b: Placed) =>
  ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention] || a.label.localeCompare(b.label) || a.itemId.localeCompare(b.itemId);

/**
 * How many parcel rows each tall station gets: everything it needs when the height
 * allows, else one row each and the spare rows to the stations missing the most.
 */
function allocateRows(needs: number[], budgetRows: number): number[] {
  const rowsFor: number[] = needs.map((n) => (n > 0 ? 1 : 0));
  let spare = budgetRows - rowsFor.reduce((a, b) => a + b, 0);
  while (spare > 0) {
    let best = -1;
    for (let i = 0; i < needs.length; i++) if (needs[i]! > rowsFor[i]! && (best < 0 || needs[i]! - rowsFor[i]! > needs[best]! - rowsFor[best]!)) best = i;
    if (best < 0) break;
    rowsFor[best]!++;
    spare--;
  }
  return rowsFor;
}

export function floorScene(view: EdgeView, box: { width: number; height: number }, options: FloorOptions = {}): FloorScene {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  // Width alone decides: a phone's floor box can be wider than tall (the desks below squeeze
  // it), and eight columns in 390pt truncate every label (BOB-101).
  const orientation: Orientation = options.orientation ?? (width >= WIDE_MIN_WIDTH ? "wide" : "tall");
  const scope = options.scope ?? {};
  const itemRows = rows(view, options.now).filter((r) => inScope(r, scope) && (options.projectId === undefined || r.issue.projectId === options.projectId));
  const all = itemRows.map((r) => parcelFor(r, options.now));
  disambiguate(all);
  // Issues are de-duplicated against every coordinator item, not only those in scope.
  const tracked = issueParcels(view, rows(view), options.projectId, options.now);
  all.push(...tracked.parcels);

  const byStation = new Map<StationId, Placed[]>(FLOOR_STATIONS.map((s) => [s.id, []]));
  for (const p of all) byStation.get(p.stationId)!.push(p);
  for (const list of byStation.values()) list.sort(byAttention);

  const belt = FLOOR_STATIONS.filter((s) => s.kind === "belt");
  const bins = FLOOR_STATIONS.filter((s) => s.kind === "bin");
  const binsUsed = bins.some((s) => byStation.get(s.id)!.length > 0);
  const stations: FloorStationNode[] = [];
  const parcels: FloorParcel[] = [];
  const overflow: FloorOverflow[] = [];
  const worst = (list: Placed[]) => (list.length ? list[0]!.attention : null);

  const place = (id: StationId, slots: { x: number; y: number }[]) => {
    const list = byStation.get(id)!;
    const room = Math.max(1, slots.length);
    const shown = list.length > room ? room - 1 : list.length;
    list.slice(0, shown).forEach((p, i) => parcels.push({ ...p, ...slots[i]! }));
    if (list.length > shown) overflow.push({ stationId: id, count: list.length - shown, ...slots[shown]! });
  };

  const parcel: FloorScene["parcel"] =
    orientation === "wide" ? { w: Math.round(Math.min(96, Math.max(56, (width - PAD * 2) / belt.length - 8))), h: PARCEL_H } : { w: 86, h: PARCEL_H };
  // Bins sit in a band under the belt, each taking half its width, as tall as their rows.
  const binW = (width - PAD * 2) / bins.length;
  const binCols = Math.max(1, Math.floor((binW - GAP) / (parcel.w + GAP)));
  const binRows = binsUsed ? Math.min(BIN_ROWS_MAX, Math.max(...bins.map((s) => Math.ceil(byStation.get(s.id)!.length / binCols)))) : 0;
  const binBand = binsUsed ? 22 + binRows * (parcel.h + GAP) : BIN_BAND_EMPTY;
  const beltBottom = height - binBand;
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
    // Tall (iPhone): stations stack down a vertical belt. Empty ones collapse to a thin
    // labelled row; stations with parcels get the height, wrapping onto more rows.
    const labelW = 74;
    const beltX = PAD + labelW;
    const firstX = beltX + 14 + parcel.w / 2;
    const cols = Math.max(1, Math.floor((width - PAD - (beltX + 14)) / (parcel.w + GAP)));
    const pitch = parcel.h + GAP;
    const counts = belt.map((s) => byStation.get(s.id)!.length);
    const used = counts.filter((n) => n > 0).length;
    const avail = beltBottom - PAD;
    // A used station is rows × pitch − GAP + 2 × STATION_PAD high.
    const budgetRows = Math.max(used, Math.floor((avail - (belt.length - used) * EMPTY_ROW - used * (STATION_PAD * 2 - GAP)) / pitch));
    const rowsFor = allocateRows(counts.map((n) => Math.ceil(n / cols)), budgetRows);
    const heights = rowsFor.map((r) => (r === 0 ? EMPTY_ROW : r * pitch - GAP + STATION_PAD * 2));
    // Spare height goes back evenly, so a quiet floor still spans the box.
    const spare = Math.max(0, avail - heights.reduce((a, b) => a + b, 0));
    const grow = Math.min(spare / belt.length, 28);
    let top = PAD;
    belt.forEach((s, i) => {
      const list = byStation.get(s.id)!;
      const h = heights[i]! + grow;
      const rowCount = rowsFor[i]!;
      // The label and marker sit on the station's first row (or mid-band when it is empty).
      const firstY = top + grow / 2 + STATION_PAD + parcel.h / 2;
      const y = rowCount === 0 ? top + h / 2 : firstY;
      stations.push({ id: s.id, label: s.label, kind: "belt", x: beltX, y, count: list.length, attention: worst(list) });
      if (rowCount > 0) {
        const slots = Array.from({ length: rowCount * cols }, (_, k) => ({ x: firstX + (k % cols) * (parcel.w + GAP), y: firstY + Math.floor(k / cols) * pitch }));
        place(s.id, slots);
      }
      top += h;
    });
    beltLine = { x1: beltX, y1: PAD, x2: beltX, y2: Math.min(beltBottom, top) };
  }

  const binY = beltBottom + 6;
  bins.forEach((s, i) => {
    const x0 = PAD + binW * i;
    const list = byStation.get(s.id)!;
    stations.push({ id: s.id, label: s.label, kind: "bin", x: x0, y: binY, count: list.length, attention: worst(list) });
    if (!list.length) return;
    const startX = x0 + parcel.w / 2;
    place(s.id, Array.from({ length: binCols * binRows }, (_, k) => ({ x: startX + (k % binCols) * (parcel.w + GAP), y: binY + 16 + parcel.h / 2 + Math.floor(k / binCols) * (parcel.h + GAP) })));
  });

  return { orientation, width, height, parcel, belt: beltLine, stations, parcels, overflow, backlog: tracked.backlog };
}

/** The scene as text, one line per non-empty station: the screen-reader view of the floor. */
export function floorSummary(scene: FloorScene): string[] {
  return scene.stations
    .filter((s) => s.count > 0)
    .map((s) => {
      const items = scene.parcels
        .filter((p) => p.stationId === s.id)
        .map((p) => {
          const name = p.kind === "item" && p.sublabel ? `${p.label} ${p.sublabel}` : p.label;
          return p.marker ? `${name} (${p.attention.replace("_", " ")})` : name;
        });
      const more = scene.overflow.find((o) => o.stationId === s.id);
      return `${s.label}: ${items.join(", ")}${more ? `, and ${more.count} more` : ""}`;
    });
}

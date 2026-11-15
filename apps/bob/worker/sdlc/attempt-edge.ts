// BOB-80 (BOB-75 Phase 3): the SdlcEdge's attempt level. Watches (one item per socket, in
// the socket's hibernation-safe attachment), the ephemeral live tail, and display-only CI.
// Runs under node tests with fakes; edge-do.ts wires it to the DO.
import type { AttemptMessage, ItemSnapshot, PlanSnapshot, TailFrame, TopologyRepo, WatchMessage } from "@bob/sdlc-view";
import { readAttachment, type AttachedSocket } from "./edge-sockets";
import { MAX_POLLED_ITEMS, type FgCiSource } from "./fg";
import { isViewer } from "./routes";
import { parseTailPost, TailHub } from "./tail";

export interface AttemptEdgeOptions {
  /** Every socket the DO holds (ctx.getWebSockets()); attachments decide who watches what. */
  sockets: () => AttachedSocket[];
  item: (itemId: string) => ItemSnapshot | undefined;
  plan: (planId: string) => PlanSnapshot | undefined;
  topology: () => TopologyRepo[];
  ci: Pick<FgCiSource, "message">;
  /** SDLC_VIEWER_USER_IDS as it is now; re-read on every watch and fan-out. */
  viewerIds: () => string | undefined;
  now?: () => number;
  /** ctx.waitUntil in the DO. */
  schedule?: (work: Promise<unknown>) => void;
}

const send = (socket: AttachedSocket, message: AttemptMessage) => {
  try { socket.send(JSON.stringify(message)); } catch { /* closed */ }
};

export class AttemptEdge {
  readonly tail = new TailHub();
  private readonly now: () => number;
  private readonly schedule: (work: Promise<unknown>) => void;

  constructor(private readonly options: AttemptEdgeOptions) {
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((work) => { work.catch(() => {}); });
  }

  /** A socket may watch when it has said hello and its user is on the allow-list now. */
  private allowed(socket: AttachedSocket): boolean {
    const { greeted, userId } = readAttachment(socket);
    return greeted === true && typeof userId === "string" && userId.length > 0 && isViewer(userId, this.options.viewerIds());
  }

  /** Sockets watching itemId, allow-list re-checked. */
  watchers(itemId: string): AttachedSocket[] {
    return this.options.sockets().filter((s) => readAttachment(s).watch === itemId && this.allowed(s));
  }

  /** Distinct items watched by allowed sockets. */
  watchedItems(): string[] {
    const ids = new Set<string>();
    for (const s of this.options.sockets()) {
      const { watch } = readAttachment(s);
      if (watch && this.allowed(s)) ids.add(watch);
    }
    return [...ids];
  }

  /**
   * A WatchMessage. Ignored unless the socket may watch. Stores the item (or clears it) in
   * the attachment, then replies to this socket only: the latest tail frame held, a
   * tailUnavailable marker when a running / waiting-input item has had no frame within
   * TAIL_STALE_MS, and the CI detail (asynchronously). Returns whether a watch was set.
   */
  watch(socket: AttachedSocket, message: WatchMessage): boolean {
    if (!this.allowed(socket)) return false;
    const { watch: _previous, ...rest } = readAttachment(socket);
    socket.serializeAttachment(message.itemId === null ? rest : { ...rest, watch: message.itemId });
    if (message.itemId === null) return false;
    const itemId = message.itemId;
    const latest = this.tail.get(itemId);
    if (latest) send(socket, { type: "tail", frame: latest.frame });
    const item = this.options.item(itemId);
    const marker = this.tail.unavailable(itemId, item?.state, this.now());
    if (marker) send(socket, marker);
    if (item) this.schedule(this.ciFor(item).then((message) => { if (readAttachment(socket).watch === itemId) send(socket, message); }));
    return true;
  }

  /** Holds the latest frame per item and sends each to that item's watchers. Never stored. */
  ingestTail(frames: TailFrame[]): number {
    const now = this.now();
    for (const frame of frames) {
      this.tail.put(frame, now);
      for (const socket of this.watchers(frame.itemId)) send(socket, { type: "tail", frame });
    }
    return frames.length;
  }

  /**
   * One CI poll: reads CI for up to MAX_POLLED_ITEMS watched items and sends each to its
   * watchers. Returns whether anything is still watched (the DO re-arms its alarm only then).
   */
  async pollCi(): Promise<boolean> {
    const watched = this.watchedItems();
    await Promise.all(watched.slice(0, MAX_POLLED_ITEMS).map(async (itemId) => {
      const item = this.options.item(itemId);
      if (!item) return;
      const message = await this.ciFor(item);
      for (const socket of this.watchers(itemId)) send(socket, message);
    }));
    return watched.length > 0;
  }

  private ciFor(item: ItemSnapshot) {
    return this.options.ci.message(item, this.options.plan(item.planId), this.options.topology());
  }
}

/** The DO's answer to a tail body: 400 unless it parses; otherwise how many frames were relayed. */
export function tailResponse(edge: Pick<AttemptEdge, "ingestTail">, text: string): Response {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return Response.json({ error: "invalid tail" }, { status: 400 }); }
  const frames = parseTailPost(value);
  if (!frames) return Response.json({ error: "invalid tail" }, { status: 400 });
  return Response.json({ accepted: edge.ingestTail(frames) });
}

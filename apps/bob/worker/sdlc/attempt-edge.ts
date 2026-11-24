// BOB-80 (BOB-75 Phase 3): the SdlcEdge's attempt level. Watches (up to MAX_WATCHED_ITEMS
// per socket since BOB-94, in the socket's hibernation-safe attachment), the ephemeral live tail, and display-only CI.
// Runs under node tests with fakes; edge-do.ts wires it to the DO.
import { watchedIds, type AttemptMessage, type ItemSnapshot, type PlanSnapshot, type TailFrame, type TopologyRepo, type WatchMessage } from "@bob/sdlc-view";
import { mayWatch, readAttachment, watchesOf, type AttachedSocket } from "./edge-sockets";
import { MAX_POLLED_ITEMS, type FgCiSource } from "./fg";
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
    return mayWatch(readAttachment(socket), this.options.viewerIds());
  }

  /** Sockets watching itemId, allow-list re-checked. */
  watchers(itemId: string): AttachedSocket[] {
    return this.options.sockets().filter((s) => watchesOf(readAttachment(s)).includes(itemId) && this.allowed(s));
  }

  /** Distinct items watched by allowed sockets. */
  watchedItems(): string[] {
    const ids = new Set<string>();
    for (const s of this.options.sockets()) {
      if (!this.allowed(s)) continue;
      for (const id of watchesOf(readAttachment(s))) ids.add(id);
    }
    return [...ids];
  }

  /**
   * A WatchMessage. Ignored unless the socket may watch. Replaces the socket's watch set in
   * its attachment (watchedIds: deduped, at most MAX_WATCHED_ITEMS), then replies to this
   * socket only, for each item newly in the set: the latest tail frame held, a
   * tailUnavailable marker when a running / waiting-input item has had no frame within
   * TAIL_STALE_MS, and the CI detail (asynchronously, dropped if the item left the set
   * meanwhile). Items already watched get nothing again. Returns whether anything is watched.
   */
  watch(socket: AttachedSocket, message: WatchMessage): boolean {
    if (!this.allowed(socket)) return false;
    const { watch: _legacy, watches: _previous, ...rest } = readAttachment(socket);
    const before = new Set(watchesOf(readAttachment(socket)));
    const ids = watchedIds(message);
    socket.serializeAttachment(ids.length === 0 ? rest : { ...rest, watches: ids });
    for (const itemId of ids) {
      if (before.has(itemId)) continue;
      const latest = this.tail.get(itemId);
      if (latest) send(socket, { type: "tail", frame: latest.frame });
      const item = this.options.item(itemId);
      const marker = this.tail.unavailable(itemId, item?.state, this.now());
      if (marker) send(socket, marker);
      if (item) this.schedule(this.ciFor(item).then((ci) => { if (watchesOf(readAttachment(socket)).includes(itemId)) send(socket, ci); }));
    }
    return ids.length > 0;
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

  /** A single read of the same live evidence a socket receives when it starts watching. */
  async detail(item: ItemSnapshot) {
    const tail = this.tail.get(item.itemId)?.frame;
    const marker = this.tail.unavailable(item.itemId, item.state, this.now());
    return { tail, tailUnavailable: marker?.reason, ci: await this.ciFor(item) };
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

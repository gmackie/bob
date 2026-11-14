import type { EdgeMessage, TopologyRepo } from "@bob/sdlc-view";
import type { SqlPort } from "./sql";
import { DeltaLog, EdgeStore, type IngestBatch, type IngestResult } from "./store";

export interface EdgeSocket { send(data: string): void }
/**
 * What a client sends on connect: its view's seq and epoch. A client with no view, or
 * whose view has needsResync set (it applied a delta after a seq gap), sends cursor null
 * and gets a snapshot. See the protocol note on EdgeMessage in @bob/sdlc-view.
 */
export interface Hello { cursor: number | null; epoch: string | null }
export interface EdgeControllerOptions {
  sql: SqlPort;
  sockets: () => EdgeSocket[];
  now?: () => number;
  loadTopology?: () => Promise<TopologyRepo[]>;
  /** Keeps background work running after a reply: ctx.waitUntil in the Durable Object. */
  schedule?: (work: Promise<unknown>) => void;
  newEpoch?: () => string;
}

const TOPOLOGY_TTL_MS = 5 * 60_000;
const TOPOLOGY_RETRY_MS = 60_000;

/**
 * The SDLC edge's behaviour, with storage, sockets, clock and BizPulse injected so it
 * runs under node. The Durable Object only delegates to it.
 *
 * Storage is synchronous SQLite: each change commits in one transaction before anything
 * is logged or broadcast, so memory, the delta log and storage cannot disagree. If the
 * transaction throws, ingest throws, nothing changes, and the exporter retries.
 * When the coordinator was last heard from is kept in memory only (heartbeats write nothing).
 */
export class EdgeController {
  readonly store: EdgeStore;
  private readonly log = new DeltaLog();
  private readonly sockets: () => EdgeSocket[];
  private readonly now: () => number;
  private readonly loadTopology?: () => Promise<TopologyRepo[]>;
  private readonly schedule: (work: Promise<unknown>) => void;
  private coordinatorSeenAt: number | null = null;
  private topologyLoad: Promise<void> | null = null;

  constructor(options: EdgeControllerOptions) {
    this.store = new EdgeStore(options.sql, options.newEpoch);
    this.sockets = options.sockets;
    this.now = options.now ?? Date.now;
    this.loadTopology = options.loadTopology;
    this.schedule = options.schedule ?? ((work) => { work.catch(() => {}); });
  }

  /** Throws when storage fails; the route answers 5xx so the exporter retries the batch. */
  ingest(batch: IngestBatch): IngestResult {
    const now = this.now();
    const { result, message, covered } = this.store.apply(batch, now);
    if (!result.accepted) return result;
    this.coordinatorSeenAt = Math.max(this.coordinatorSeenAt ?? now, now);
    if (message) this.publish(message);
    else if (!covered) this.broadcast({ type: "status", coordinatorSeenAt: this.coordinatorSeenAt });
    return result;
  }

  /**
   * Replies at once, before any await: the deltas after the client's cursor when the log
   * holds all of them and the epoch matches, otherwise a snapshot; then a status. A stale
   * topology is refreshed afterwards, and a change reaches every client as a snapshot.
   */
  hello(socket: EdgeSocket, hello: Hello): void {
    const { epoch, seq } = this.store.meta();
    const deltas = hello.cursor === null || hello.epoch !== epoch ? null : this.log.since(hello.cursor, seq);
    const reply: EdgeMessage[] = deltas ?? [this.store.snapshot(this.coordinatorSeenAt)];
    reply.push({ type: "status", coordinatorSeenAt: this.coordinatorSeenAt });
    for (const message of reply) socket.send(JSON.stringify(message));
    const work = this.refreshTopology();
    if (work) this.schedule(work);
  }

  /** Starts a BizPulse refresh when the topology is stale and no failure is recent; one at a time. */
  refreshTopology(): Promise<void> | null {
    if (!this.loadTopology || this.topologyLoad) return this.topologyLoad;
    const { topologyAt, topologyFailedAt } = this.store.meta();
    const now = this.now();
    if (topologyAt !== null && now - topologyAt < TOPOLOGY_TTL_MS) return null;
    if (topologyFailedAt !== null && now - topologyFailedAt < TOPOLOGY_RETRY_MS) return null;
    const load = this.loadTopology;
    this.topologyLoad = (async () => {
      let topology: TopologyRepo[];
      try { topology = await load(); }
      catch { this.store.markTopologyFailed(this.now()); return; } // keep the last good topology
      const message = this.store.setTopology(topology, this.now(), this.coordinatorSeenAt);
      if (message) this.publish(message);
    })().finally(() => { this.topologyLoad = null; });
    return this.topologyLoad;
  }

  /** Call only after the change has committed. */
  private publish(message: EdgeMessage) {
    this.log.push(message);
    this.broadcast(message);
  }

  private broadcast(message: EdgeMessage) {
    const data = JSON.stringify(message);
    for (const socket of this.sockets()) {
      try { socket.send(data); } catch { /* closed socket */ }
    }
  }
}

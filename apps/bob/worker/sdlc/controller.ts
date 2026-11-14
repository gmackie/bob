import { reduce, type TopologyRepo } from "@bob/sdlc-view";
import { applyBatch, DeltaLog, emptyEdge, helloReply, snapshotOf, type EdgeState, type IngestBatch, type IngestResult } from "./store";

export interface EdgeStorage { get(): Promise<EdgeState | undefined>; put(state: EdgeState): Promise<void> }
export interface EdgeSocket { send(data: string): void }
const TOPOLOGY_TTL_MS = 5 * 60_000;

/**
 * The SDLC edge's behaviour, with storage, sockets, clock and BizPulse injected so it
 * runs under node. The Durable Object only delegates to it.
 *
 * Every state change reads this.state and writes it back in one synchronous step, so
 * an await in between (a BizPulse fetch, which a DO's input gate does not cover) cannot
 * make one change overwrite another.
 */
export class EdgeController {
  private state: EdgeState | null = null;
  private loading: Promise<EdgeState> | null = null;
  private topologyLoad: Promise<void> | null = null;
  private readonly log = new DeltaLog();
  constructor(
    private readonly storage: EdgeStorage,
    private readonly sockets: () => EdgeSocket[],
    private readonly now: () => number = Date.now,
    private readonly loadTopology?: () => Promise<TopologyRepo[]>,
  ) {}

  private async current(): Promise<EdgeState> {
    if (this.state) return this.state;
    this.loading ??= this.storage.get().then((stored) => (this.state ??= stored ?? emptyEdge()));
    return this.loading;
  }

  async ingest(batch: IngestBatch): Promise<IngestResult> {
    await this.current();
    const { state, result, message } = applyBatch(this.state!, batch, this.now());
    if (!result.accepted) return result;
    this.state = state;
    await this.storage.put(state);
    if (message) { this.log.push(message); this.broadcast(JSON.stringify(message)); }
    return result;
  }

  async hello(socket: EdgeSocket, cursor: number | null): Promise<void> {
    await this.current();
    await this.refreshTopology(socket);
    // A topology change bumped seq and cleared the log, so an older cursor gets a snapshot.
    for (const message of helloReply(this.state!, this.log, cursor)) socket.send(JSON.stringify(message));
  }

  /** Refreshes the BizPulse topology when stale; one request at a time. */
  private refreshTopology(requester: EdgeSocket): Promise<void> {
    const at = this.state!.topologyAt;
    if (!this.loadTopology || (at !== undefined && this.now() - at < TOPOLOGY_TTL_MS)) return Promise.resolve();
    this.topologyLoad ??= this.applyTopology(this.loadTopology, requester).finally(() => { this.topologyLoad = null; });
    return this.topologyLoad;
  }

  private async applyTopology(load: () => Promise<TopologyRepo[]>, requester: EdgeSocket): Promise<void> {
    let topology: TopologyRepo[];
    try { topology = await load(); }
    catch { return; } // keep the last good topology; the next hello retries
    const state = this.state!; // re-read: batches may have landed during the fetch
    const topologyAt = this.now();
    if (JSON.stringify(topology) === JSON.stringify(state.view.topology)) {
      this.state = { ...state, topologyAt };
      await this.storage.put(this.state);
      return;
    }
    // A changed topology is a new snapshot: it takes the next seq, so clients that
    // resume from an older cursor are sent a snapshot rather than nothing.
    const message = { ...snapshotOf(state), seq: state.view.seq + 1, topology };
    this.state = { ...state, topologyAt, view: reduce(state.view, message) };
    await this.storage.put(this.state);
    this.log.push(message);
    // The requester gets its own reply from hello().
    this.broadcast(JSON.stringify(message), requester);
  }

  private broadcast(data: string, except?: EdgeSocket) {
    for (const socket of this.sockets()) {
      if (socket === except) continue;
      try { socket.send(data); } catch { /* closed socket */ }
    }
  }
}

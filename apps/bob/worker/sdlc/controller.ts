import {
  COMMAND_LIMITS,
  confirmationSatisfies,
  OFFLINE_AFTER_MS,
  parseClientCommand,
  tierOf as defaultTierOf,
  type CommandInput,
  type CommandRejectCode,
  type CommandResult,
  type CommandStatusMessage,
  type EdgeMessage,
  type Tier,
  type TopologyRepo,
} from "@bob/sdlc-view";
import { CommandOutbox } from "./outbox";
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
  /** How many sockets are open (greeted or not); any keeps the exporter polling fast. Default: sockets().length. */
  connected?: () => number;
  /** Tests only: no operation is tier 3 yet, so the typed-confirmation path needs an override. */
  tierOf?: (command: CommandInput) => Tier;
}

/** The exporter polls this often while commands are queued or anyone is watching. */
export const FAST_POLL_MS = 2_000;

/**
 * Who sent a command, as the socket's attachment and the DO's env say. The route put the
 * user id on the upgrade; the allow-list is checked again here because it can change.
 */
export interface CommandSender {
  userId: string | null;
  viewer: boolean;
  /** Counts this command against the socket's per-minute limit; false when it is over. */
  take: () => boolean;
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
  readonly outbox: CommandOutbox;
  private readonly connected: () => number;
  private readonly tierOf: (command: CommandInput) => Tier;

  constructor(options: EdgeControllerOptions) {
    this.store = new EdgeStore(options.sql, options.newEpoch);
    this.sockets = options.sockets;
    this.now = options.now ?? Date.now;
    this.loadTopology = options.loadTopology;
    this.schedule = options.schedule ?? ((work) => { work.catch(() => {}); });
    this.outbox = new CommandOutbox(options.sql);
    this.connected = options.connected ?? (() => this.sockets().length);
    this.tierOf = options.tierOf ?? defaultTierOf;
  }

  /**
   * Throws when storage fails; the route answers 5xx so the exporter retries the batch.
   * State and commands are two transactions: if the second fails after the first committed,
   * the retried batch is a covered replay for the state and the results apply then.
   * Results and queued commands travel on every response, a resync included.
   */
  ingest(batch: IngestBatch): IngestResult {
    const now = this.now();
    const { result, message, covered } = this.store.apply(batch, now);
    if (result.accepted) {
      this.coordinatorSeenAt = Math.max(this.coordinatorSeenAt ?? now, now);
      if (message) this.publish(message);
      else if (!covered) this.broadcast({ type: "status", coordinatorSeenAt: this.coordinatorSeenAt });
    }
    const { finished, commands, pending } = this.outbox.exchange(batch.results ?? [], now);
    for (const finishedResult of finished) this.broadcastResult(finishedResult);
    return { ...result, commands, ...(pending > 0 || this.connected() > 0 ? { pollMs: FAST_POLL_MS } : {}) };
  }

  /** Whether the coordinator was heard from within the offline banner's window. */
  coordinatorOnline(now = this.now()): boolean {
    return this.coordinatorSeenAt !== null && now - this.coordinatorSeenAt <= OFFLINE_AFTER_MS;
  }

  /**
   * A client's command. Checks, in order: sender (forbidden), shape (invalid), rate
   * (rate-limited); a commandId already known is answered from the outbox or the stored
   * result without being queued again; then coordinator online, tier + confirmation,
   * outbox size. Accepted commands are stored before the reply. Replies to `socket` only.
   */
  command(socket: EdgeSocket, raw: unknown, sender: CommandSender): CommandStatusMessage {
    const commandId = typeof (raw as { commandId?: unknown } | null)?.commandId === "string" ? (raw as { commandId: string }).commandId.slice(0, 200) : "";
    const reply = (message: CommandStatusMessage) => { try { socket.send(JSON.stringify(message)); } catch { /* closed */ } return message; };
    const reject = (code: CommandRejectCode, message: string) => reply({ type: "commandRejected", commandId, code, message });
    if (sender.userId === null || !sender.viewer) return reject("forbidden", "Not allowed to send commands.");
    const command = parseClientCommand(raw);
    if (!command) return reject("invalid", "Malformed command or unknown operation.");
    if (!sender.take()) return reject("rate-limited", `At most ${COMMAND_LIMITS.maxPerSocketPerMinute} commands a minute.`);
    const known = this.outbox.result(command.commandId);
    if (known) return reply({ type: "commandResult", ...known });
    if (this.outbox.isQueued(command.commandId)) return reply({ type: "commandAccepted", commandId: command.commandId });
    const now = this.now();
    if (!this.coordinatorOnline(now)) return reject("coordinator-offline", "The coordinator is offline; try again when it reconnects.");
    const { type: _type, commandId: _id, confirm, ...input } = command;
    const tier = this.tierOf(input);
    if (!confirmationSatisfies(tier, confirm, tier === 3 ? this.expectedConfirmation(input) : undefined)) {
      return reject("confirmation-required", tier === 3 ? "Type the name to confirm." : "This command needs confirmation.");
    }
    const expired = this.outbox.expire(now);
    for (const result of expired) this.broadcastResult(result);
    if (this.outbox.size() >= COMMAND_LIMITS.maxQueued) return reject("outbox-full", "Too many commands are waiting for the coordinator.");
    this.outbox.enqueue({ commandId: command.commandId, actor: sender.userId, queuedAt: now, ...input });
    return reply({ type: "commandAccepted", commandId: command.commandId });
  }

  /** What a tier-3 command must type: the plan id, or the item's repository. Undefined (never satisfied) when unknown. */
  expectedConfirmation(command: CommandInput): string | undefined {
    if (command.operation === "ControlPlan") return command.input.planId;
    const item = this.store.item(command.input.itemId);
    if (!item) return undefined;
    const fromExecution = item.execution?.target.repository.repositoryId;
    if (fromExecution) return fromExecution;
    return this.store.plan(item.planId)?.definition.items.find((d) => d.itemId === item.itemId)?.target.repository.repositoryId;
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

  private broadcastResult(result: CommandResult) {
    this.broadcast({ type: "commandResult", ...result });
  }

  private broadcast(message: EdgeMessage | CommandStatusMessage) {
    const data = JSON.stringify(message);
    for (const socket of this.sockets()) {
      try { socket.send(data); } catch { /* closed socket */ }
    }
  }
}

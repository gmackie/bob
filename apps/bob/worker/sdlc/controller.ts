import {
  COMMAND_LIMITS,
  confirmationSatisfies,
  decodeAnswers,
  OFFLINE_AFTER_MS,
  parseClientCommand,
  tierOf as defaultTierOf,
  type CommandInput,
  type CommandRejectCode,
  type CommandResult,
  type CommandStatusMessage,
  type EdgeMessage,
  type ShippedEntry,
  type Tier,
  type TopologyRepo,
  type IssueBatch,
  type IssueBatchResult,
} from "@bob/sdlc-view";
import { describeAlert, type SdlcAlertDelivery } from "./alerts";
import { CommandOutbox, commandHash } from "./outbox";
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
  /** Tests only: overrides the tier of an operation (RequestDeployment is the only tier 3). */
  tierOf?: (command: CommandInput) => Tier;
  /**
   * SDLC push alerts (BOB-81). Who is told (SDLC_VIEWER_USER_IDS, as it is now), and what
   * sends the planned deliveries; the DO sends them through Bob's notification service in
   * ctx.waitUntil, so it must not block. Without `notify`, nothing is planned or rate-counted.
   */
  alertRecipients?: () => string[];
  notify?: (deliveries: SdlcAlertDelivery[]) => void;
  /** One structured line per command decision (BOB-89); console.log in the DO. */
  logLine?: (line: string) => void;
  /** Items that first reached production in a committed batch (BOB-95); ShippedEdge.publish in the DO. */
  onShipped?: (entries: ShippedEntry[]) => void;
  /**
   * After every accepted ingest, heartbeats included, once the state committed (BOB-96: Live
   * Activity updates, LiveActivityEdge.flush). A throw is swallowed: it never fails the ingest.
   */
  afterIngest?: (now: number) => void;
}

/**
 * What the edge did with a client's command: queued it, answered a re-sent commandId from
 * the outbox or results, or refused it (with its code). Ids and the operation only: never
 * the input (a ResolveInput answer is user text), and never the user id.
 */
export interface CommandDecisionLog {
  event: "sdlc_edge_command";
  commandId: string;
  operation: string | null;
  outcome: "accepted" | "replayed" | "rejected";
  code?: CommandRejectCode;
}

/** The exporter polls this often while commands are queued, or for ACTIVE_POLL_WINDOW_MS after one was sent or answered. */
export const FAST_POLL_MS = 2_000;
/** How long fast polling lasts after the last command was enqueued or answered. An open socket alone does not count. */
export const ACTIVE_POLL_WINDOW_MS = 2 * 60_000;
/**
 * coordinatorSeenAt is written to the meta table at most this often (heartbeats come every
 * few seconds); far below OFFLINE_AFTER_MS, so a value loaded after eviction is close enough.
 */
export const SEEN_PERSIST_MS = 15_000;

/**
 * Who sent a command, as the socket's attachment and the DO's env say. The route put the
 * user id on the upgrade; the allow-list is checked again here because it can change.
 */
export interface CommandSender {
  userId: string | null;
  viewer: boolean;
  /** Counts this command against the user's per-minute limit (across sockets); false when it is over. */
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
 * When the coordinator was last heard from is kept in memory and persisted to the meta
 * table at most every SEEN_PERSIST_MS, so offline checks and the banner survive eviction.
 */
export class EdgeController {
  readonly store: EdgeStore;
  private readonly log = new DeltaLog();
  private readonly sockets: () => EdgeSocket[];
  private readonly now: () => number;
  private readonly loadTopology?: () => Promise<TopologyRepo[]>;
  private readonly schedule: (work: Promise<unknown>) => void;
  private coordinatorSeenAt: number | null;
  private persistedSeenAt: number | null;
  private topologyLoad: Promise<void> | null = null;
  readonly outbox: CommandOutbox;
  private readonly tierOf: (command: CommandInput) => Tier;
  private readonly alertRecipients: () => string[];
  private readonly notify?: (deliveries: SdlcAlertDelivery[]) => void;
  private readonly logLine: (line: string) => void;
  private readonly onShipped?: (entries: ShippedEntry[]) => void;
  private readonly afterIngest?: (now: number) => void;

  constructor(options: EdgeControllerOptions) {
    this.store = new EdgeStore(options.sql, options.newEpoch);
    this.sockets = options.sockets;
    this.now = options.now ?? Date.now;
    this.loadTopology = options.loadTopology;
    this.schedule = options.schedule ?? ((work) => { work.catch(() => {}); });
    this.outbox = new CommandOutbox(options.sql);
    this.coordinatorSeenAt = this.persistedSeenAt = this.store.coordinatorSeenAt();
    this.tierOf = options.tierOf ?? defaultTierOf;
    this.alertRecipients = options.alertRecipients ?? (() => []);
    this.notify = options.notify;
    this.logLine = options.logLine ?? ((line) => console.log(line));
    this.onShipped = options.onShipped;
    this.afterIngest = options.afterIngest;
  }

  /**
   * Throws when storage fails; the route answers 5xx so the exporter retries the batch.
   * State and commands are two transactions: if the second fails after the first committed,
   * the retried batch is a covered replay for the state and the results apply then.
   * Results and queued commands travel on every response, a resync included.
   */
  ingest(batch: IngestBatch): IngestResult {
    const now = this.now();
    const { result, message, covered, alerts, shipped } = this.store.apply(batch, now);
    if (alerts.length > 0) this.sendAlerts(alerts, now);
    if (shipped.length > 0 && this.onShipped) {
      try { this.onShipped(shipped); } catch { /* a send never fails the ingest: the entries are stored */ }
    }
    if (result.accepted) {
      this.coordinatorSeenAt = Math.max(this.coordinatorSeenAt ?? now, now);
      if (this.persistedSeenAt === null || this.coordinatorSeenAt - this.persistedSeenAt >= SEEN_PERSIST_MS) {
        this.store.setCoordinatorSeenAt(this.coordinatorSeenAt);
        this.persistedSeenAt = this.coordinatorSeenAt;
      }
      if (message) this.publish(message);
      else if (!covered) this.broadcast({ type: "status", coordinatorSeenAt: this.coordinatorSeenAt });
      if (this.afterIngest) {
        try { this.afterIngest(now); } catch (error) {
          console.error(JSON.stringify({ event: "sdlc_edge_after_ingest_failed", error: error instanceof Error ? error.message : String(error) }));
        }
      }
    }
    const { finished, commands, pending } = this.outbox.exchange(batch.results ?? [], now);
    for (const finishedResult of finished) this.broadcastResult(finishedResult);
    const active = pending > 0 || this.outbox.answeredSince(now - ACTIVE_POLL_WINDOW_MS);
    return { ...result, commands, ...(active ? { pollMs: FAST_POLL_MS } : {}) };
  }

  /**
   * BOB-99: a mirrored Kanbanger issue batch from the coordinator. Stored in one transaction,
   * then broadcast as a delta (it takes the next seq, like any other change). The mirror runs
   * in the coordinator worker, so a batch also counts as hearing from the coordinator.
   */
  ingestIssues(batch: IssueBatch): IssueBatchResult {
    const now = this.now();
    this.coordinatorSeenAt = Math.max(this.coordinatorSeenAt ?? now, now);
    const { message, stored, removed } = this.store.applyIssues(batch, this.coordinatorSeenAt);
    if (message) this.publish(message);
    return { accepted: true, stored, removed };
  }

  /**
   * After the state committed: plans per-user deliveries within the push limit and hands
   * them off. A failure here is logged and never fails the ingest (the state is stored).
   */
  private sendAlerts(alerts: Parameters<typeof describeAlert>[0][], now: number) {
    if (!this.notify) return;
    try {
      const contents = alerts.map((alert) => describeAlert(alert, this.store.item(alert.itemId), this.store.plan(alert.planId)));
      const deliveries = this.store.alerts.plan(contents, this.alertRecipients(), now);
      if (deliveries.length > 0) this.notify(deliveries);
    } catch (error) {
      console.error(JSON.stringify({ event: "sdlc_edge_alert_failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** Whether the coordinator was heard from within the offline banner's window. */
  coordinatorOnline(now = this.now()): boolean {
    return this.coordinatorSeenAt !== null && now - this.coordinatorSeenAt <= OFFLINE_AFTER_MS;
  }

  /**
   * A client's command. Checks, in order: sender (forbidden), shape (invalid), rate
   * (rate-limited); a commandId already known is answered from the outbox or the stored
   * result without being queued again, unless its operation + input differ from what was
   * queued (conflict); then coordinator online, a ResolveInput against the item's pending
   * prompt (invalid), tier + confirmation, outbox size (in all,
   * then the user's). Accepted commands are stored before the reply. Replies to `socket` only.
   * Every decision is logged as one CommandDecisionLog line (BOB-89).
   */
  command(socket: EdgeSocket, raw: unknown, sender: CommandSender): CommandStatusMessage {
    const commandId = typeof (raw as { commandId?: unknown } | null)?.commandId === "string" ? (raw as { commandId: string }).commandId.slice(0, 200) : "";
    const operationRaw = (raw as { operation?: unknown } | null)?.operation;
    const operation = typeof operationRaw === "string" ? operationRaw.slice(0, 40) : null;
    const decided = (outcome: CommandDecisionLog["outcome"], code?: CommandRejectCode) => {
      const line: CommandDecisionLog = { event: "sdlc_edge_command", commandId, operation, outcome, ...(code ? { code } : {}) };
      try { this.logLine(JSON.stringify(line)); } catch { /* logging never fails a command */ }
    };
    const reply = (message: CommandStatusMessage) => { try { socket.send(JSON.stringify(message)); } catch { /* closed */ } return message; };
    const reject = (code: CommandRejectCode, message: string) => { decided("rejected", code); return reply({ type: "commandRejected", commandId, code, message }); };
    if (sender.userId === null || !sender.viewer) return reject("forbidden", "Not allowed to send commands.");
    const command = parseClientCommand(raw);
    if (!command) return reject("invalid", "Malformed command or unknown operation.");
    if (!sender.take()) return reject("rate-limited", `At most ${COMMAND_LIMITS.maxPerUserPerMinute} commands a minute.`);
    const { type: _type, commandId: _id, confirm, ...input } = command;
    const known = this.outbox.known(command.commandId);
    if (known) {
      // A null hash is a row from before hashes were stored: it cannot be compared.
      if (known.hash !== null && known.hash !== commandHash(input)) {
        return reject("conflict", "This command id was already used for a different command.");
      }
      decided("replayed");
      return known.result ? reply({ type: "commandResult", ...known.result }) : reply({ type: "commandAccepted", commandId: command.commandId });
    }
    const now = this.now();
    if (!this.coordinatorOnline(now)) return reject("coordinator-offline", "The coordinator is offline; try again when it reconnects.");
    const stale = this.staleInput(input);
    if (stale) return reject("invalid", stale);
    const tier = this.tierOf(input);
    if (!confirmationSatisfies(tier, confirm, tier === 3 ? this.expectedConfirmation(input) : undefined)) {
      return reject("confirmation-required", tier === 3 ? "Type the name to confirm." : "This command needs confirmation.");
    }
    const expired = this.outbox.expire(now);
    for (const result of expired) this.broadcastResult(result);
    if (this.outbox.size() >= COMMAND_LIMITS.maxQueued) return reject("outbox-full", "Too many commands are waiting for the coordinator.");
    if (this.outbox.sizeFor(sender.userId) >= COMMAND_LIMITS.maxQueuedPerUser) {
      return reject("outbox-full", `You have ${COMMAND_LIMITS.maxQueuedPerUser} commands waiting for the coordinator; wait for some to finish.`);
    }
    this.outbox.enqueue({ commandId: command.commandId, actor: sender.userId, queuedAt: now, ...input });
    decided("accepted");
    return reply({ type: "commandAccepted", commandId: command.commandId });
  }

  /**
   * Why a ResolveInput cannot apply to the item as the edge holds it, or null. The item
   * must exist, be waiting-input, have a pendingInput for the same attempt and prompt, and
   * the answer must decode against its questions. Messages never quote the answer, and
   * nothing here logs it. Other operations: null (the coordinator checks versions).
   * A re-sent commandId is answered from the outbox before this runs, so a resolved prompt
   * still replays its result.
   */
  staleInput(command: CommandInput): string | null {
    if (command.operation !== "ResolveInput") return null;
    const { itemId, attemptId, promptId, answer } = command.input;
    const item = this.store.item(itemId);
    if (!item) return "Unknown item.";
    if (item.state !== "waiting-input") return "This item is not waiting for input.";
    const pending = item.pendingInput;
    if (!pending) return "This item has no pending prompt.";
    if (pending.attemptId !== attemptId || pending.promptId !== promptId) return "This prompt is no longer pending; it was answered or replaced.";
    if (!decodeAnswers(answer, pending)) return "The answer does not match the prompt's questions.";
    return null;
  }

  /** The sliding per-user minute limit, shared by all of the user's sockets. */
  takeCommandSlot(userId: string, now = this.now()): boolean {
    return this.outbox.take(userId, now);
  }

  /** What a tier-3 command must type: the plan id, or the item's repository. Undefined (never satisfied) when unknown. */
  expectedConfirmation(command: CommandInput): string | undefined {
    if (command.operation === "ControlPlan") return command.input.planId;
    // Issue commands (BOB-99) are tier 1 or 2: nothing to type.
    if (command.operation === "SetIssueState" || command.operation === "DispatchIssue") return undefined;
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

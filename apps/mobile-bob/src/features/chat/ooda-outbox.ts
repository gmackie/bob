import { v4 as uuidv4 } from "uuid";

import type {
  AppendConversationEventInputV1,
  AppendConversationEventResultV1,
  SensitivityV1,
} from "@gmacko/ooda-client/v1";

const STORAGE_KEY = "ooda:conversation-outbox:v1";

export interface OodaOutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type OodaOutboxStatus = "queued" | "syncing" | "failed";

export interface OodaOutboxItem {
  id: string;
  conversationId: string;
  branchId: string;
  idempotencyKey: string;
  status: OodaOutboxStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  input: AppendConversationEventInputV1;
}

interface PersistedOutboxV1 {
  version: 1;
  items: OodaOutboxItem[];
}

export interface OodaOutboxDeliveryReceipt {
  item: OodaOutboxItem;
  result: AppendConversationEventResultV1;
}

export interface OodaConversationOutboxOptions {
  storage: OodaOutboxStorage;
  appendEvent: (
    input: AppendConversationEventInputV1,
  ) => Promise<AppendConversationEventResultV1>;
  completeTurn?: (
    item: OodaOutboxItem,
    result: AppendConversationEventResultV1,
  ) => Promise<void>;
  createId?: () => string;
  now?: () => string;
  maxAttempts?: number;
  storageKey?: string;
}

export interface QueueTurnInput {
  conversationId: string;
  branchId: string;
  text: string;
  sensitivity?: SensitivityV1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

function isPermanentFailure(error: unknown): boolean {
  const status = errorStatus(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function cloneItems(items: OodaOutboxItem[]): OodaOutboxItem[] {
  return items.map((item) => ({
    ...item,
    input: {
      ...item.input,
      actor: { ...item.input.actor },
      payload: { ...item.input.payload },
    },
  }));
}

export class OodaConversationOutbox {
  private items: OodaOutboxItem[] = [];
  private readonly listeners = new Set<(items: OodaOutboxItem[]) => void>();
  private readonly storageKey: string;
  private readonly maxAttempts: number;
  private readonly createId: () => string;
  private readonly now: () => string;
  private flushPromise?: Promise<OodaOutboxDeliveryReceipt[]>;

  constructor(private readonly options: OodaConversationOutboxOptions) {
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.createId = options.createId ?? uuidv4;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  snapshot(): OodaOutboxItem[] {
    return cloneItems(this.items);
  }

  subscribe(listener: (items: OodaOutboxItem[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private async persist(): Promise<void> {
    const state: PersistedOutboxV1 = { version: 1, items: this.items };
    await this.options.storage.setItem(this.storageKey, JSON.stringify(state));
    this.emit();
  }

  async hydrate(): Promise<void> {
    const raw = await this.options.storage.getItem(this.storageKey);
    if (!raw) {
      this.items = [];
      this.emit();
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedOutboxV1>;
      this.items = parsed.version === 1 && Array.isArray(parsed.items)
        ? parsed.items.map((item) => item.status === "syncing"
          ? { ...item, status: "queued" as const }
          : item)
        : [];
    } catch {
      this.items = [];
    }
    await this.persist();
  }

  async enqueueTurn(input: QueueTurnInput): Promise<OodaOutboxItem> {
    const id = this.createId();
    const correlationId = this.createId();
    const timestamp = this.now();
    const item: OodaOutboxItem = {
      id,
      conversationId: input.conversationId,
      branchId: input.branchId,
      idempotencyKey: id,
      status: "queued",
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      input: {
        conversationId: input.conversationId,
        branchId: input.branchId,
        type: "user_turn",
        actor: { type: "user" },
        payload: { display: input.text },
        sensitivity: input.sensitivity ?? "personal",
        correlationId,
        idempotencyKey: id,
        occurredAt: timestamp,
      },
    };
    this.items.push(item);
    await this.persist();
    return cloneItems([item])[0] ?? item;
  }

  async retry(id: string): Promise<void> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    item.status = "queued";
    item.attempts = 0;
    item.error = undefined;
    item.updatedAt = this.now();
    await this.persist();
  }

  flush(): Promise<OodaOutboxDeliveryReceipt[]> {
    if (this.flushPromise) return this.flushPromise;
    const active = this.flushInternal().finally(() => {
      if (this.flushPromise === active) this.flushPromise = undefined;
    });
    this.flushPromise = active;
    return active;
  }

  private async flushInternal(): Promise<OodaOutboxDeliveryReceipt[]> {
    const receipts: OodaOutboxDeliveryReceipt[] = [];
    const blockedConversations = new Set<string>();
    const pendingIds = this.items
      .filter((item) => item.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((item) => item.id);

    for (const id of pendingIds) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (item?.status !== "queued") continue;
      if (blockedConversations.has(item.conversationId)) continue;

      item.status = "syncing";
      item.attempts += 1;
      item.error = undefined;
      item.updatedAt = this.now();
      await this.persist();

      let eventAccepted = false;
      try {
        const result = await this.options.appendEvent(item.input);
        eventAccepted = true;
        await this.options.completeTurn?.(cloneItems([item])[0] ?? item, result);
        receipts.push({ item: cloneItems([item])[0] ?? item, result });
        this.items = this.items.filter((candidate) => candidate.id !== id);
        await this.persist();
      } catch (error) {
        const hostStillRunning = eventAccepted && errorStatus(error) === 409;
        item.status = (!hostStillRunning && isPermanentFailure(error))
          || item.attempts >= this.maxAttempts
          ? "failed"
          : "queued";
        item.error = errorMessage(error);
        item.updatedAt = this.now();
        blockedConversations.add(item.conversationId);
        await this.persist();
      }
    }

    return receipts;
  }
}

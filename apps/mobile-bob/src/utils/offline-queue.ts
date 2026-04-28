import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { v4 as uuidv4 } from "uuid";

const QUEUE_STORAGE_KEY = "@bob/offline_queue";
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60000;

export type QueuedActionType =
  | "session.reply"
  | "task.unblock"
  | "pr.comment"
  | "task.complete";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastRetryAt: string | null;
  nextRetryAt: string | null;
  status: "pending" | "processing" | "failed";
  errorMessage: string | null;
}

export interface QueueState {
  actions: QueuedAction[];
  isProcessing: boolean;
}

type ActionHandler = (action: QueuedAction) => Promise<void>;

let handlers: Map<QueuedActionType, ActionHandler> = new Map();
let isProcessing = false;
let networkUnsubscribe: (() => void) | null = null;

export function registerActionHandler(
  type: QueuedActionType,
  handler: ActionHandler,
): void {
  handlers.set(type, handler);
}

async function loadQueue(): Promise<QueuedAction[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (data) {
      return JSON.parse(data) as QueuedAction[];
    }
  } catch (error) {
    console.error("Failed to load offline queue:", error);
  }
  return [];
}

async function saveQueue(actions: QueuedAction[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(actions));
  } catch (error) {
    console.error("Failed to save offline queue:", error);
  }
}

function calculateNextRetryDelay(retryCount: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

export async function enqueueAction(
  type: QueuedActionType,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const action: QueuedAction = {
    id,
    type,
    payload,
    createdAt: now,
    retryCount: 0,
    lastRetryAt: null,
    nextRetryAt: now,
    status: "pending",
    errorMessage: null,
  };

  const queue = await loadQueue();
  queue.push(action);
  await saveQueue(queue);

  processQueue();

  return id;
}

export async function removeAction(actionId: string): Promise<void> {
  const queue = await loadQueue();
  const filtered = queue.filter((a) => a.id !== actionId);
  await saveQueue(filtered);
}

export async function getQueueState(): Promise<QueueState> {
  const actions = await loadQueue();
  return {
    actions,
    isProcessing,
  };
}

export async function clearQueue(): Promise<void> {
  await saveQueue([]);
}

export async function clearFailedActions(): Promise<number> {
  const queue = await loadQueue();
  const remaining = queue.filter((a) => a.status !== "failed");
  const removed = queue.length - remaining.length;
  await saveQueue(remaining);
  return removed;
}

export async function retryFailedAction(actionId: string): Promise<boolean> {
  const queue = await loadQueue();
  const action = queue.find((a) => a.id === actionId);

  if (!action || action.status !== "failed") {
    return false;
  }

  action.status = "pending";
  action.retryCount = 0;
  action.errorMessage = null;
  action.nextRetryAt = new Date().toISOString();

  await saveQueue(queue);
  processQueue();

  return true;
}

export async function retryAllFailed(): Promise<number> {
  const queue = await loadQueue();
  let retried = 0;

  for (const action of queue) {
    if (action.status === "failed") {
      action.status = "pending";
      action.retryCount = 0;
      action.errorMessage = null;
      action.nextRetryAt = new Date().toISOString();
      retried++;
    }
  }

  if (retried > 0) {
    await saveQueue(queue);
    processQueue();
  }

  return retried;
}

async function processQueue(): Promise<void> {
  if (isProcessing) {
    return;
  }

  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    return;
  }

  isProcessing = true;

  try {
    const queue = await loadQueue();
    const now = new Date();

    const pendingActions = queue.filter(
      (a) =>
        a.status === "pending" &&
        a.nextRetryAt &&
        new Date(a.nextRetryAt) <= now,
    );

    for (const action of pendingActions) {
      const handler = handlers.get(action.type);
      if (!handler) {
        console.warn(`No handler registered for action type: ${action.type}`);
        continue;
      }

      action.status = "processing";
      await saveQueue(queue);

      try {
        await handler(action);

        const updatedQueue = await loadQueue();
        const idx = updatedQueue.findIndex((a) => a.id === action.id);
        if (idx >= 0) {
          updatedQueue.splice(idx, 1);
          await saveQueue(updatedQueue);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        action.retryCount++;
        action.lastRetryAt = now.toISOString();
        action.errorMessage = errorMessage;

        if (action.retryCount >= MAX_RETRIES) {
          action.status = "failed";
          action.nextRetryAt = null;
        } else {
          action.status = "pending";
          const delay = calculateNextRetryDelay(action.retryCount);
          action.nextRetryAt = new Date(now.getTime() + delay).toISOString();
        }

        await saveQueue(queue);
      }
    }
  } finally {
    isProcessing = false;
  }

  const remaining = await loadQueue();
  const hasPending = remaining.some(
    (a) => a.status === "pending" && a.nextRetryAt,
  );

  if (hasPending) {
    const nextAction = remaining
      .filter((a) => a.status === "pending" && a.nextRetryAt)
      .sort((a, b) => a.nextRetryAt!.localeCompare(b.nextRetryAt!))[0];

    if (nextAction?.nextRetryAt) {
      const delay = Math.max(
        0,
        new Date(nextAction.nextRetryAt).getTime() - Date.now(),
      );
      setTimeout(() => processQueue(), delay);
    }
  }
}

export function startQueueProcessing(): void {
  processQueue();

  networkUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      processQueue();
    }
  });
}

export function stopQueueProcessing(): void {
  if (networkUnsubscribe) {
    networkUnsubscribe();
    networkUnsubscribe = null;
  }
}

export async function enqueueSessionReply(
  sessionId: string,
  message: string,
  clientInputId?: string,
): Promise<string> {
  return enqueueAction("session.reply", {
    sessionId,
    message,
    clientInputId: clientInputId ?? uuidv4(),
  });
}

export async function enqueueTaskUnblock(
  taskRunId: string,
  reply: string,
): Promise<string> {
  return enqueueAction("task.unblock", {
    taskRunId,
    reply,
  });
}

export async function enqueuePRComment(
  pullRequestId: string,
  body: string,
): Promise<string> {
  return enqueueAction("pr.comment", {
    pullRequestId,
    body,
  });
}

export async function enqueueTaskComplete(taskRunId: string): Promise<string> {
  return enqueueAction("task.complete", {
    taskRunId,
  });
}

export function getPendingCount(queue: QueuedAction[]): number {
  return queue.filter((a) => a.status === "pending").length;
}

export function getFailedCount(queue: QueuedAction[]): number {
  return queue.filter((a) => a.status === "failed").length;
}

export function getProcessingCount(queue: QueuedAction[]): number {
  return queue.filter((a) => a.status === "processing").length;
}

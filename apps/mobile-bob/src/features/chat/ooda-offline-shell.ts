import type {
  ConversationBranchV1,
  ConversationV1,
  OodaRolloutPolicyV1,
} from "@gmacko/ooda-client/v1";

export const OODA_OFFLINE_SHELL_STORAGE_KEY = "ooda:offline-shell:v1";
export const OODA_LAST_CONVERSATION_STORAGE_KEY = "ooda:last-conversation:v1";
export const OODA_PINNED_CONVERSATIONS_STORAGE_KEY =
  "ooda:pinned-conversations:v1";

export interface OodaOfflineShellStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface OodaOfflineShellV1 {
  conversation: ConversationV1;
  branches: ConversationBranchV1[];
  rollout: OodaRolloutPolicyV1;
  cachedAt: string;
}

export interface OodaLocalStartupState {
  lastConversationId: string | null;
  pinnedIds: string[];
  shell: OodaOfflineShellV1 | null;
}

const rolloutStages = new Set<OodaRolloutPolicyV1["stage"]>([
  "shadow",
  "conversations",
  "mobile_text",
  "tts",
  "jobs",
  "obsidian",
  "durable_work",
  "portfolio_evidence",
  "specialists",
  "reviews_push",
]);

const capabilityKeys = [
  "shadow_projection",
  "conversation_read",
  "conversation_write",
  "mobile_text",
  "tts",
  "agent_jobs",
  "obsidian_delivery",
  "durable_work_delivery",
  "portfolio_evidence",
  "specialist_delivery",
  "reviews",
  "push",
] as const satisfies readonly (keyof OodaRolloutPolicyV1["capabilities"])[];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isoDate(value: unknown): value is string {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function pinnedConversationIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => nonEmptyString(item))
      : [];
  } catch {
    return [];
  }
}

function conversationValue(value: unknown): ConversationV1 | null {
  const row = record(value);
  if (
    !row ||
    !nonEmptyString(row.id) ||
    !nonEmptyString(row.ownerId) ||
    !nonEmptyString(row.title) ||
    (row.status !== "active" && row.status !== "archived") ||
    !nonEmptyString(row.hostProvider) ||
    !nonEmptyString(row.hostProfile) ||
    !nonEmptyString(row.activeBranchId) ||
    typeof row.lastSequence !== "string" ||
    !/^\d+$/.test(row.lastSequence) ||
    !["general", "personal", "sensitive", "restricted"].includes(
      String(row.sensitivityCeiling),
    ) ||
    !["allowed", "manual", "disabled", "sensitive_denied"].includes(
      String(row.ttsPolicy),
    ) ||
    !isoDate(row.createdAt) ||
    !isoDate(row.updatedAt)
  ) {
    return null;
  }
  return row as ConversationV1;
}

function branchValue(
  value: unknown,
  conversationId: string,
): ConversationBranchV1 | null {
  const row = record(value);
  if (
    !row ||
    !nonEmptyString(row.id) ||
    row.conversationId !== conversationId ||
    !nonEmptyString(row.name) ||
    (row.parentBranchId !== undefined && !nonEmptyString(row.parentBranchId)) ||
    (row.forkEventId !== undefined && !nonEmptyString(row.forkEventId)) ||
    (row.reason !== undefined && typeof row.reason !== "string") ||
    !isoDate(row.createdAt) ||
    !isoDate(row.updatedAt)
  ) {
    return null;
  }
  return row as ConversationBranchV1;
}

function rolloutValue(value: unknown): OodaRolloutPolicyV1 | null {
  const row = record(value);
  const capabilities = record(row?.capabilities);
  if (
    !row ||
    !rolloutStages.has(row.stage as OodaRolloutPolicyV1["stage"]) ||
    typeof row.eligible !== "boolean" ||
    typeof row.killed !== "boolean" ||
    !capabilities ||
    capabilityKeys.some((key) => typeof capabilities[key] !== "boolean") ||
    !Array.isArray(row.reasons) ||
    row.reasons.some((reason) => !nonEmptyString(reason)) ||
    (row.dogfoodStartedAt !== undefined && !isoDate(row.dogfoodStartedAt))
  ) {
    return null;
  }
  return row as unknown as OodaRolloutPolicyV1;
}

export async function loadOodaOfflineShell(
  storage: OodaOfflineShellStorage,
): Promise<OodaOfflineShellV1 | null> {
  const raw = await storage.getItem(OODA_OFFLINE_SHELL_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = record(JSON.parse(raw));
    if (parsed?.version !== 1 || !isoDate(parsed.cachedAt)) return null;
    const conversation = conversationValue(parsed.conversation);
    const rollout = rolloutValue(parsed.rollout);
    if (!conversation || !rollout || !Array.isArray(parsed.branches))
      return null;
    const branches = parsed.branches.map((branch) =>
      branchValue(branch, conversation.id),
    );
    if (
      branches.some((branch) => !branch) ||
      !branches.some((branch) => branch?.id === conversation.activeBranchId)
    ) {
      return null;
    }
    return {
      conversation,
      branches: branches as ConversationBranchV1[],
      rollout,
      cachedAt: parsed.cachedAt,
    };
  } catch {
    return null;
  }
}

export async function saveOodaOfflineShell(
  storage: OodaOfflineShellStorage,
  shell: OodaOfflineShellV1,
): Promise<void> {
  await storage.setItem(
    OODA_OFFLINE_SHELL_STORAGE_KEY,
    JSON.stringify({ version: 1, ...shell }),
  );
}

async function bestEffortStorageWrite(
  write: () => Promise<void>,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    return false;
  }
}

export async function rememberOodaConversation(
  storage: OodaOfflineShellStorage,
  conversationId: string,
): Promise<boolean> {
  return bestEffortStorageWrite(() =>
    storage.setItem(OODA_LAST_CONVERSATION_STORAGE_KEY, conversationId),
  );
}

export async function cacheOodaOfflineShell(
  storage: OodaOfflineShellStorage,
  shell: OodaOfflineShellV1,
): Promise<boolean> {
  return bestEffortStorageWrite(() => saveOodaOfflineShell(storage, shell));
}

export async function hydrateOodaLocalStartup(
  storage: OodaOfflineShellStorage,
  hydrateOutbox: () => Promise<void>,
): Promise<OodaLocalStartupState> {
  const [lastConversationId, rawPins, shell] = await Promise.all([
    storage.getItem(OODA_LAST_CONVERSATION_STORAGE_KEY),
    storage.getItem(OODA_PINNED_CONVERSATIONS_STORAGE_KEY),
    loadOodaOfflineShell(storage),
    hydrateOutbox(),
  ]);
  return {
    lastConversationId,
    pinnedIds: pinnedConversationIds(rawPins),
    shell,
  };
}

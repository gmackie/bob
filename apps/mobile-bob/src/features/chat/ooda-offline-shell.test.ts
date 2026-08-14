import type {
  ConversationBranchV1,
  ConversationV1,
  OodaRolloutPolicyV1,
} from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import {
  hydrateOodaLocalStartup,
  loadOodaOfflineShell,
  OODA_LAST_CONVERSATION_STORAGE_KEY,
  OODA_OFFLINE_SHELL_STORAGE_KEY,
  OODA_PINNED_CONVERSATIONS_STORAGE_KEY,
  rememberOodaConversation,
  saveOodaOfflineShell,
} from "./ooda-offline-shell";

function memoryStorage(initial: string | null = null) {
  const writes: { key: string; value: string }[] = [];
  let value = initial;
  return {
    storage: {
      getItem: (key: string) =>
        Promise.resolve(key === OODA_OFFLINE_SHELL_STORAGE_KEY ? value : null),
      setItem: (key: string, next: string) => {
        writes.push({ key, value: next });
        value = next;
        return Promise.resolve();
      },
    },
    writes,
  };
}

const conversation: ConversationV1 = {
  id: "conversation-1",
  ownerId: "owner-1",
  title: "Offline thought",
  status: "active",
  hostProvider: "grok",
  hostProfile: "daily",
  activeBranchId: "branch-1",
  lastSequence: "4",
  sensitivityCeiling: "personal",
  ttsPolicy: "allowed",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:01:00.000Z",
};

const branch: ConversationBranchV1 = {
  id: "branch-1",
  conversationId: conversation.id,
  name: "main",
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
};

const rollout: OodaRolloutPolicyV1 = {
  stage: "durable_work",
  eligible: true,
  killed: false,
  capabilities: {
    shadow_projection: true,
    conversation_read: true,
    conversation_write: true,
    mobile_text: true,
    tts: true,
    agent_jobs: true,
    obsidian_delivery: true,
    durable_work_delivery: true,
    portfolio_evidence: false,
    specialist_delivery: false,
    reviews: false,
    push: false,
  },
  reasons: [],
  dogfoodStartedAt: "2026-08-09T15:44:45.000Z",
};

describe("OODA offline conversation shell", () => {
  it("hydrates the visible local conversation before live startup is available", async () => {
    const shell = {
      conversation,
      branches: [branch],
      rollout,
      cachedAt: "2026-08-14T00:02:00.000Z",
    };
    const values = new Map<string, string>([
      [OODA_LAST_CONVERSATION_STORAGE_KEY, conversation.id],
      [
        OODA_PINNED_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify([conversation.id]),
      ],
      [
        OODA_OFFLINE_SHELL_STORAGE_KEY,
        JSON.stringify({ version: 1, ...shell }),
      ],
    ]);
    let outboxHydrated = false;

    const startup = await hydrateOodaLocalStartup(
      {
        getItem: (key) => Promise.resolve(values.get(key) ?? null),
        setItem: () => Promise.resolve(),
      },
      () => {
        outboxHydrated = true;
        return Promise.resolve();
      },
    );

    expect(outboxHydrated).toBe(true);
    expect(startup).toEqual({
      lastConversationId: conversation.id,
      pinnedIds: [conversation.id],
      shell,
    });
  });

  it("restores the last conversation and rollout policy after a cold restart", async () => {
    const persisted = memoryStorage();
    await saveOodaOfflineShell(persisted.storage, {
      conversation,
      branches: [branch],
      rollout,
      cachedAt: "2026-08-14T00:02:00.000Z",
    });

    const restored = await loadOodaOfflineShell(persisted.storage);

    expect(restored).toEqual({
      conversation,
      branches: [branch],
      rollout,
      cachedAt: "2026-08-14T00:02:00.000Z",
    });
    expect(persisted.writes).toHaveLength(1);
    const [write] = persisted.writes;
    expect(write).toBeDefined();
    expect(JSON.parse(write?.value ?? "")).toMatchObject({
      version: 1,
    });
  });

  it("does not turn a local selection-cache failure into a chat failure", async () => {
    await expect(
      rememberOodaConversation(
        {
          getItem: () => Promise.resolve(null),
          setItem: () =>
            Promise.reject(new Error("device storage unavailable")),
        },
        conversation.id,
      ),
    ).resolves.toBe(false);
  });

  it.each([
    null,
    "not-json",
    JSON.stringify({ version: 2 }),
    JSON.stringify({
      version: 1,
      cachedAt: "invalid",
      conversation,
      branches: [branch],
      rollout,
    }),
    JSON.stringify({
      version: 1,
      cachedAt: "2026-08-14T00:02:00.000Z",
      conversation,
      branches: [{ ...branch, conversationId: "someone-else" }],
      rollout,
    }),
  ])("rejects an unsafe or malformed cached shell", async (raw) => {
    await expect(
      loadOodaOfflineShell(memoryStorage(raw).storage),
    ).resolves.toBeNull();
  });
});

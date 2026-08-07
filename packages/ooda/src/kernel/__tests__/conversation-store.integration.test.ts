import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "../../db/schema";
import {
  archiveConversation,
  createConversation,
  forkConversation,
  getConversation,
  listConversations,
} from "../conversations";
import {
  appendConversationEvent,
  correctConversationEvent,
  listConversationEvents,
} from "../events";
import { consumeTtsGrant, createTtsGrant } from "../tts-grants";
import { createHostTurn } from "../host-turns";
import { HostRoutingError } from "../host-routing";
import { stableStringify } from "../serialization";
import {
  cancelAgentJob,
  claimAgentJob,
  createAgentJob,
  getAgentJob,
  recordAgentJobEvent,
} from "../agent-jobs";
import { createProposal, decideProposal, getProposal } from "../proposals";
import {
  claimIntegrationDelivery,
  completeIntegrationDelivery,
  failIntegrationDelivery,
  listDeadLetters,
  repairDeadLetter,
} from "../integration-deliveries";

const DATABASE_URL = process.env.OODA_KERNEL_TEST_DATABASE_URL;
const HAS_DB = Boolean(DATABASE_URL);

const sql = HAS_DB ? postgres(DATABASE_URL!, { max: 20 }) : null;
const db = sql ? drizzle({ client: sql, schema, casing: "snake_case" }) : null;

function migration(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../drizzle/${name}`, import.meta.url)),
    "utf8",
  );
}

async function applyMigration(source: string) {
  const statements = source.split("--> statement-breakpoint");
  for (let statement of statements) {
    if (process.env.OODA_KERNEL_TEST_DISABLE_VECTOR === "1") {
      if (
        statement.includes("CREATE EXTENSION IF NOT EXISTS vector") ||
        statement.includes("memory_seeds_embedding_hnsw_idx")
      )
        continue;
      statement = statement.replace("vector(1536)", "double precision[]");
    }
    if (statement.trim()) await sql!.unsafe(statement);
  }
}

describe.skipIf(!HAS_DB)("OODA conversation store", () => {
  beforeAll(async () => {
    await sql!`drop schema if exists ooda cascade`;
    await applyMigration(migration("0006_clean_viper.sql"));
    await applyMigration(migration("0007_wet_surge.sql"));
    await applyMigration(migration("0008_ooda_kernel_idempotency.sql"));
    await applyMigration(migration("0009_lethal_the_fury.sql"));
    await applyMigration(migration("0010_lying_scream.sql"));
    await applyMigration(migration("0011_noisy_prodigy.sql"));
    await applyMigration(migration("0012_typical_franklin_richards.sql"));
    await applyMigration(migration("0013_nasty_rogue.sql"));
  });

  afterAll(async () => {
    await sql!`drop schema if exists ooda cascade`;
    await sql!.end({ timeout: 2 });
  });

  it("creates a replay-safe conversation with its root branch", async () => {
    const input = {
      title: "Voice-first daily driver",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal" as const,
      ttsPolicy: "allowed" as const,
      idempotencyKey: "create-conversation-1",
    };

    const first = await createConversation(db!, "owner-a", input);
    const replay = await createConversation(db!, "owner-a", input);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.conversation.id).toBe(first.conversation.id);
    expect(replay.branch.id).toBe(first.branch.id);
    expect(first.conversation.activeBranchId).toBe(first.branch.id);
    expect(first.conversation.lastSequence).toBe("0");
  });

  it("allocates unique monotonically increasing sequences under concurrency", async () => {
    const created = await createConversation(db!, "owner-a", {
      title: "Concurrent turn",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-concurrent",
    });

    const writes = Array.from({ length: 24 }, (_, index) =>
      appendConversationEvent(db!, "owner-a", {
        conversationId: created.conversation.id,
        branchId: created.branch.id,
        type: "user_turn",
        actor: { type: "user", id: "owner-a" },
        payload: { display: `turn-${index}` },
        sensitivity: "general",
        correlationId: "concurrency-proof",
        idempotencyKey: `append-concurrent-${index}`,
        occurredAt: new Date(1_785_953_600_000 + index).toISOString(),
      }),
    );

    const results = await Promise.all(writes);
    const sequences = results
      .map(({ event }) => Number(event.sequence))
      .sort((a, b) => a - b);

    expect(sequences).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    expect(new Set(sequences)).toHaveLength(24);
  });

  it("issues replay-safe TTS grants that can be consumed exactly once", async () => {
    const created = await createConversation(db!, "owner-voice", {
      title: "Speak this response",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-voice",
    });
    const response = await appendConversationEvent(db!, "owner-voice", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "assistant_turn",
      actor: { type: "host", id: "grok" },
      payload: {
        display: "A longer answer for the display.",
        speakable: "A concise spoken answer.",
      },
      sensitivity: "personal",
      correlationId: "voice-proof",
      idempotencyKey: "voice-assistant-event",
      occurredAt: "2026-08-05T18:00:00.000Z",
    });
    const input = {
      conversationId: created.conversation.id,
      eventId: response.event.id,
      requestMode: "automatic" as const,
      idempotencyKey: "voice-grant-1",
    };
    const options = {
      baseUrl: "https://ooda.example",
      grantSecret: "0123456789abcdef0123456789abcdef",
      now: new Date("2026-08-05T18:00:01.000Z"),
    };

    const first = await createTtsGrant(db!, "owner-voice", input, options);
    const replay = await createTtsGrant(db!, "owner-voice", input, options);
    const token = decodeURIComponent(
      new URL(first.streamUrl).pathname.split("/").at(-1)!,
    );

    expect(replay).toEqual({ ...first, replayed: true });
    await expect(
      consumeTtsGrant(db!, "owner-voice", token, {
        now: new Date("2026-08-05T18:00:02.000Z"),
      }),
    ).resolves.toEqual({
      text: "A concise spoken answer.",
      grantId: first.grantId,
    });
    await expect(
      consumeTtsGrant(db!, "owner-voice", token, {
        now: new Date("2026-08-05T18:00:03.000Z"),
      }),
    ).rejects.toMatchObject({ code: "TTS_GRANT_UNAVAILABLE", status: 410 });
  });

  it("answers one durable user event exactly once across client retries", async () => {
    const created = await createConversation(db!, "owner-host", {
      title: "Canonical host response",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-host",
    });
    const user = await appendConversationEvent(db!, "owner-host", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host" },
      payload: { display: "Help me think this through" },
      sensitivity: "personal",
      correlationId: "host-proof",
      idempotencyKey: "host-user-event",
      occurredAt: "2026-08-05T18:00:00.000Z",
    });
    let calls = 0;
    const provider = {
      id: "grok" as const,
      complete: () => {
        calls += 1;
        return Promise.resolve({
          providerResponseId: "grok-response-1",
          model: "grok-4.5",
          text: '{"display":"Full considered answer","speakable":"Short answer"}',
        });
      },
    };
    const input = {
      conversationId: created.conversation.id,
      userEventId: user.event.id,
      idempotencyKey: "host-turn-1",
    };

    const first = await createHostTurn(db!, "owner-host", input, {
      providers: [provider],
    });
    const replay = await createHostTurn(db!, "owner-host", input, {
      providers: [provider],
    });

    expect(first.assistantEvent.payload).toMatchObject({
      display: "Full considered answer",
      speakable: "Short answer",
      provider: "grok",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(calls).toBe(1);
  });

  it("repairs a host execution after the assistant event was persisted before a crash", async () => {
    const created = await createConversation(db!, "owner-host-recovery", {
      title: "Recover persisted host response",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-host-recovery",
    });
    const user = await appendConversationEvent(db!, "owner-host-recovery", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-recovery" },
      payload: { display: "Do not answer this twice" },
      sensitivity: "personal",
      correlationId: "host-recovery-proof",
      idempotencyKey: "host-recovery-user-event",
      occurredAt: "2026-08-05T18:00:00.000Z",
    });
    const input = {
      conversationId: created.conversation.id,
      userEventId: user.event.id,
      idempotencyKey: "host-recovery-turn",
    };
    const [execution] = await db!
      .insert(schema.hostTurnExecutions)
      .values({
        ownerId: "owner-host-recovery",
        conversationId: created.conversation.id,
        userEventId: user.event.id,
        idempotencyKey: input.idempotencyKey,
        commandFingerprint: stableStringify(input),
        status: "running",
        leaseExpiresAt: new Date("2026-08-05T18:10:00.000Z"),
        startedAt: new Date("2026-08-05T18:00:00.000Z"),
      })
      .returning();
    const assistant = await appendConversationEvent(
      db!,
      "owner-host-recovery",
      {
        conversationId: created.conversation.id,
        branchId: created.branch.id,
        type: "assistant_turn",
        actor: { type: "host", id: "grok" },
        payload: {
          display: "The already-persisted answer",
          speakable: "The persisted answer",
          provider: "grok",
          model: "grok-4.5",
          providerResponseId: "grok-recovery-response",
        },
        sensitivity: "personal",
        correlationId: "host-recovery-proof",
        causationId: user.event.id,
        idempotencyKey: `${input.idempotencyKey}:assistant`,
        occurredAt: "2026-08-05T18:00:01.000Z",
      },
    );
    let calls = 0;

    const result = await createHostTurn(db!, "owner-host-recovery", input, {
      now: new Date("2026-08-05T18:00:02.000Z"),
      providers: [
        {
          id: "grok",
          complete: () => {
            calls += 1;
            return Promise.reject(new Error("provider must not be called"));
          },
        },
      ],
    });

    expect(result).toMatchObject({
      assistantEvent: { id: assistant.event.id },
      provider: "grok",
      model: "grok-4.5",
      providerResponseId: "grok-recovery-response",
      replayed: true,
    });
    expect(calls).toBe(0);
    const [repaired] = await db!
      .select()
      .from(schema.hostTurnExecutions)
      .where(eq(schema.hostTurnExecutions.id, execution!.id));
    expect(repaired).toMatchObject({
      status: "completed",
      assistantEventId: assistant.event.id,
      provider: "grok",
      model: "grok-4.5",
      providerResponseId: "grok-recovery-response",
    });
  });

  it("preserves the host-routing failure when a retry replays an older failure event", async () => {
    const created = await createConversation(db!, "owner-host-failure", {
      title: "Retry provider failures",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-host-failure",
    });
    const user = await appendConversationEvent(db!, "owner-host-failure", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-failure" },
      payload: { display: "Try the available hosts" },
      sensitivity: "personal",
      correlationId: "host-failure-proof",
      idempotencyKey: "host-failure-user-event",
      occurredAt: "2026-08-05T18:00:00.000Z",
    });
    const input = {
      conversationId: created.conversation.id,
      userEventId: user.event.id,
      idempotencyKey: "host-failure-turn",
    };

    await expect(
      createHostTurn(db!, "owner-host-failure", input, {
        now: new Date("2026-08-05T18:00:01.000Z"),
        providers: [],
      }),
    ).rejects.toBeInstanceOf(HostRoutingError);
    await expect(
      createHostTurn(db!, "owner-host-failure", input, {
        now: new Date("2026-08-05T18:00:02.000Z"),
        providers: [
          {
            id: "grok",
            complete: () =>
              Promise.reject(new Error("temporarily unavailable")),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(HostRoutingError);

    const [execution] = await db!
      .select()
      .from(schema.hostTurnExecutions)
      .where(eq(schema.hostTurnExecutions.userEventId, user.event.id));
    expect(execution).toMatchObject({
      status: "failed",
      errorCode: "HOST_UNAVAILABLE",
    });
  });

  it("answers a fork with ancestor context through the branch fork event", async () => {
    const created = await createConversation(db!, "owner-host-branch", {
      title: "Branch-aware host context",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-host-branch",
    });
    const rootUser = await appendConversationEvent(db!, "owner-host-branch", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-branch" },
      payload: { display: "I am considering a bakery" },
      sensitivity: "personal",
      correlationId: "host-branch-proof",
      idempotencyKey: "host-branch-root-user",
      occurredAt: "2026-08-05T18:00:00.000Z",
    });
    const rootAssistant = await appendConversationEvent(
      db!,
      "owner-host-branch",
      {
        conversationId: created.conversation.id,
        branchId: created.branch.id,
        type: "assistant_turn",
        actor: { type: "host", id: "grok" },
        payload: { display: "Start with customer interviews" },
        sensitivity: "personal",
        correlationId: "host-branch-proof",
        causationId: rootUser.event.id,
        idempotencyKey: "host-branch-root-assistant",
        occurredAt: "2026-08-05T18:00:01.000Z",
      },
    );
    const fork = await forkConversation(db!, "owner-host-branch", {
      conversationId: created.conversation.id,
      parentBranchId: created.branch.id,
      forkEventId: rootAssistant.event.id,
      name: "wholesale-path",
      reason: "Explore wholesale separately",
      idempotencyKey: "host-branch-fork",
    });
    const childUser = await appendConversationEvent(db!, "owner-host-branch", {
      conversationId: created.conversation.id,
      branchId: fork.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-branch" },
      payload: { display: "What about wholesale first?" },
      sensitivity: "personal",
      correlationId: "host-branch-proof",
      idempotencyKey: "host-branch-child-user",
      occurredAt: "2026-08-05T18:00:02.000Z",
    });
    let receivedMessages: Array<{
      role: "user" | "assistant";
      content: string;
    }> = [];

    await createHostTurn(
      db!,
      "owner-host-branch",
      {
        conversationId: created.conversation.id,
        userEventId: childUser.event.id,
        idempotencyKey: "host-branch-turn",
      },
      {
        providers: [
          {
            id: "grok",
            complete: ({ messages }) => {
              receivedMessages = messages;
              return Promise.resolve({
                providerResponseId: "host-branch-response",
                model: "grok-4.5",
                text: '{"display":"Test wholesale demand","speakable":"Test wholesale demand"}',
              });
            },
          },
        ],
      },
    );

    expect(receivedMessages).toEqual([
      { role: "user", content: "I am considering a bakery" },
      { role: "assistant", content: "Start with customer interviews" },
      { role: "user", content: "What about wholesale first?" },
    ]);
  });

  it("persists an inspectable disclosure pack and supplies only disclosed project context to the host", async () => {
    const created = await createConversation(db!, "owner-host-context", {
      title: "Context-aware host",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-host-context",
    });
    const user = await appendConversationEvent(db!, "owner-host-context", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-context" },
      payload: { display: "What should we do next on OODA?" },
      sensitivity: "personal",
      correlationId: "host-context-proof",
      idempotencyKey: "host-context-user",
      occurredAt: "2026-08-07T12:00:00.000Z",
    });
    let receivedSystem = "";

    const result = await createHostTurn(
      db!,
      "owner-host-context",
      {
        conversationId: created.conversation.id,
        userEventId: user.event.id,
        idempotencyKey: "host-context-turn",
      },
      {
        providers: [
          {
            id: "grok",
            complete: ({ system }) => {
              receivedSystem = system;
              return Promise.resolve({
                providerResponseId: "host-context-response",
                model: "grok-4.5",
                text: '{"display":"Ship the context inspector","speakable":"Ship the context inspector"}',
              });
            },
          },
        ],
        contextSources: [
          {
            id: "project-systems",
            inspect: () =>
              Promise.resolve([
                {
                  sourceType: "kanbanger_issue" as const,
                  sourceId: "OOD-7",
                  sensitivity: "general" as const,
                  content: "OOD-7 - in progress - Add the context inspector",
                },
                {
                  sourceType: "bizpulse_venture" as const,
                  sourceId: "venture-secret",
                  sensitivity: "sensitive" as const,
                  content: "Confidential runway is six months",
                },
              ]),
          },
        ],
      },
    );

    expect(result.contextPackId).toBeTruthy();
    expect(receivedSystem).toContain("OOD-7");
    expect(receivedSystem).not.toContain("six months");

    const [pack] = await db!
      .select()
      .from(schema.contextPacks)
      .where(eq(schema.contextPacks.id, result.contextPackId!));
    const items = await db!
      .select()
      .from(schema.contextItems)
      .where(eq(schema.contextItems.contextPackId, result.contextPackId!));
    expect(pack).toMatchObject({
      conversationId: created.conversation.id,
      provider: "grok",
      purpose: "host_turn",
      policySnapshot: {
        sourceReceipts: expect.arrayContaining([
          expect.objectContaining({
            source: "bizpulse",
            status: "unavailable",
            reason: "Source not configured",
          }),
        ]),
      },
    });
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "kanbanger_issue",
          sourceId: "OOD-7",
          decision: "disclosed",
        }),
        expect.objectContaining({
          sourceType: "bizpulse_venture",
          sourceId: "venture-secret",
          decision: "denied",
          content: null,
        }),
      ]),
    );
  });

  it("replays identical event writes and rejects reuse with changed content", async () => {
    const created = await createConversation(db!, "owner-a", {
      title: "Replay",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-replay",
    });
    const input = {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn" as const,
      actor: { type: "user" as const, id: "owner-a" },
      payload: { display: "Remember this" },
      sensitivity: "personal" as const,
      correlationId: "replay-proof",
      idempotencyKey: "append-replay-1",
      occurredAt: "2026-08-05T18:00:00.000Z",
    };

    const first = await appendConversationEvent(db!, "owner-a", input);
    const replay = await appendConversationEvent(db!, "owner-a", input);

    expect(replay).toEqual({ event: first.event, replayed: true });
    await expect(
      appendConversationEvent(db!, "owner-a", {
        ...input,
        payload: { display: "Different content" },
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
  });

  it("collapses concurrent retries with one idempotency key into one sequence", async () => {
    const created = await createConversation(db!, "owner-a", {
      title: "Concurrent retry",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-concurrent-retry",
    });
    const input = {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn" as const,
      actor: { type: "user" as const, id: "owner-a" },
      payload: { display: "One accepted turn" },
      sensitivity: "general" as const,
      correlationId: "concurrent-retry-proof",
      idempotencyKey: "same-device-retry",
      occurredAt: "2026-08-05T18:00:00.000Z",
    };

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        appendConversationEvent(db!, "owner-a", input),
      ),
    );

    expect(new Set(results.map(({ event }) => event.id))).toHaveLength(1);
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(
      (await getConversation(db!, "owner-a", created.conversation.id))
        .conversation.lastSequence,
    ).toBe("1");
  });

  it("forks from a real event and records corrections without mutating history", async () => {
    const created = await createConversation(db!, "owner-a", {
      title: "Branches and corrections",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-branch",
    });
    const original = await appendConversationEvent(db!, "owner-a", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-a" },
      payload: { display: "recpie idea" },
      sensitivity: "personal",
      correlationId: "branch-proof",
      idempotencyKey: "branch-original",
      occurredAt: "2026-08-05T18:00:00.000Z",
    });

    const branch = await forkConversation(db!, "owner-a", {
      conversationId: created.conversation.id,
      parentBranchId: created.branch.id,
      forkEventId: original.event.id,
      name: "recipe-path",
      reason: "Keep the recipe tangent separate",
      idempotencyKey: "fork-recipe-path",
    });
    const replay = await forkConversation(db!, "owner-a", {
      conversationId: created.conversation.id,
      parentBranchId: created.branch.id,
      forkEventId: original.event.id,
      name: "recipe-path",
      reason: "Keep the recipe tangent separate",
      idempotencyKey: "fork-recipe-path",
    });
    const correction = await correctConversationEvent(db!, "owner-a", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      correctedEventId: original.event.id,
      replacementPayload: { display: "recipe idea" },
      reason: "Speech recognition typo",
      sensitivity: "personal",
      correlationId: "branch-proof",
      idempotencyKey: "correct-original",
      occurredAt: "2026-08-05T18:01:00.000Z",
    });

    expect(branch.replayed).toBe(false);
    expect(replay).toEqual({ branch: branch.branch, replayed: true });
    expect(branch.branch.forkEventId).toBe(original.event.id);
    expect(correction.event.type).toBe("correction");
    expect(correction.event.payload).toEqual({
      correctedEventId: original.event.id,
      replacementPayload: { display: "recipe idea" },
      reason: "Speech recognition typo",
    });

    const page = await listConversationEvents(db!, "owner-a", {
      conversationId: created.conversation.id,
      limit: 10,
    });
    expect(page.items.map((event) => event.type)).toEqual([
      "user_turn",
      "correction",
    ]);
    expect(page.items[0]?.payload).toEqual({ display: "recpie idea" });
  });

  it("uses opaque keyset cursors and enforces ownership", async () => {
    for (let index = 0; index < 3; index += 1) {
      await createConversation(db!, "owner-page", {
        title: `Page ${index}`,
        hostProvider: "grok",
        hostProfile: "daily",
        sensitivityCeiling: "personal",
        ttsPolicy: "allowed",
        idempotencyKey: `create-page-${index}`,
      });
    }

    const first = await listConversations(db!, "owner-page", { limit: 2 });
    const second = await listConversations(db!, "owner-page", {
      limit: 2,
      cursor: first.pageInfo.nextCursor,
    });

    expect(first.items).toHaveLength(2);
    expect(first.pageInfo.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)),
    ).toHaveLength(3);

    await expect(
      getConversation(db!, "not-the-owner", first.items[0]!.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const archived = await archiveConversation(db!, "owner-page", {
      conversationId: first.items[0]!.id,
      idempotencyKey: "archive-page-1",
    });
    expect(archived.conversation.status).toBe("archived");
  });

  it("creates, replays, claims, and completes a bounded agent job", async () => {
    const conversation = await createConversation(db!, "owner-jobs", {
      title: "Research then decide",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "jobs-conversation",
    });
    const input = {
      conversationId: conversation.conversation.id,
      class: "read_only_research" as const,
      prompt: "Compare the two implementation approaches.",
      capabilities: ["web.read", "project_context.read"],
      idempotencyKey: "research-job-1",
    };

    const created = await createAgentJob(db!, "owner-jobs", input);
    const replay = await createAgentJob(db!, "owner-jobs", input);
    expect(created.replayed).toBe(false);
    expect(replay).toEqual({ job: created.job, replayed: true });
    expect(created.job).toMatchObject({
      provider: "codex",
      capabilities: ["project_context.read", "web.read"],
      budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
      status: "queued",
    });

    const claim = await claimAgentJob(db!, {
      runnerId: "runner-a",
      providers: ["codex"],
      classes: ["read_only_research"],
      leaseSeconds: 90,
    });
    expect(claim).toMatchObject({
      job: { id: created.job.id, status: "running" },
      prompt: input.prompt,
    });

    const completed = await recordAgentJobEvent(db!, {
      jobId: created.job.id,
      runnerId: "runner-a",
      type: "completed",
      payload: {
        result: { summary: "Approach A is lower risk." },
        tokensUsed: 42,
      },
      idempotencyKey: "runner-complete-1",
      occurredAt: "2026-08-07T15:00:00.000Z",
    });
    const eventReplay = await recordAgentJobEvent(db!, {
      jobId: created.job.id,
      runnerId: "runner-a",
      type: "completed",
      payload: {
        result: { summary: "Approach A is lower risk." },
        tokensUsed: 42,
      },
      idempotencyKey: "runner-complete-1",
      occurredAt: "2026-08-07T15:00:00.000Z",
    });
    expect(completed.job.status).toBe("completed");
    expect(eventReplay).toEqual({ ...completed, replayed: true });
    await expect(
      getAgentJob(db!, "another-owner", created.job.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("limits active jobs and turns a running cancellation into runner control", async () => {
    const conversation = await createConversation(db!, "owner-capacity", {
      title: "Bounded autonomy",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "capacity-conversation",
    });
    for (let index = 0; index < 3; index += 1) {
      await createAgentJob(db!, "owner-capacity", {
        conversationId: conversation.conversation.id,
        class: "read_only_research",
        prompt: `Research lane ${index}`,
        idempotencyKey: `capacity-job-${index}`,
      });
    }
    await expect(
      createAgentJob(db!, "owner-capacity", {
        conversationId: conversation.conversation.id,
        class: "read_only_research",
        prompt: "This fourth lane must wait.",
        idempotencyKey: "capacity-job-3",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const claim = await claimAgentJob(db!, {
      runnerId: "runner-capacity",
      providers: ["codex"],
      classes: ["read_only_research"],
      leaseSeconds: 90,
    });
    const cancelled = await cancelAgentJob(db!, "owner-capacity", {
      jobId: claim!.job.id,
      idempotencyKey: "cancel-running-job",
    });
    expect(cancelled.job.status).toBe("running");
    expect(cancelled.job.cancellationRequestedAt).toBeDefined();
  });

  it("records approval and one Bob outbox delivery atomically", async () => {
    const conversation = await createConversation(db!, "owner-proposals", {
      title: "Turn this into a project",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "proposal-conversation",
    });
    const input = {
      conversationId: conversation.conversation.id,
      kind: "bob_project" as const,
      destination: "bob",
      risk: "durable_work" as const,
      preview: {
        name: "Voice inbox",
        desiredOutcome: "Every spoken idea can become reviewed work.",
        acceptanceCriteria: ["Approval creates one Bob project"],
      },
      rationale: "The user explicitly asked to make this durable.",
      confidence: 0.91,
      policySnapshot: { version: "proposal-policy-v1" },
      idempotencyKey: "proposal-create-1",
    };
    const created = await createProposal(db!, "owner-proposals", input);
    const replay = await createProposal(db!, "owner-proposals", input);
    expect(created.proposal.status).toBe("awaiting_approval");
    expect(replay).toEqual({ proposal: created.proposal, replayed: true });

    const decision = {
      proposalId: created.proposal.id,
      decision: "approve" as const,
      expectedVersion: 1,
      scope: "single_delivery" as const,
      rationale: "Proceed with this one project.",
      decidedAt: "2026-08-07T16:00:00.000Z",
    };
    const approved = await decideProposal(db!, "owner-proposals", decision);
    const decisionReplay = await decideProposal(
      db!,
      "owner-proposals",
      decision,
    );
    expect(approved).toMatchObject({
      proposal: { status: "approved", version: 2 },
      replayed: false,
    });
    expect(approved.outboxId).toBeDefined();
    expect(decisionReplay).toEqual({ ...approved, replayed: true });

    const [outbox] = await db!
      .select()
      .from(schema.integrationOutbox)
      .where(eq(schema.integrationOutbox.id, approved.outboxId!));
    expect(outbox).toMatchObject({
      proposalId: created.proposal.id,
      destination: "bob",
      status: "pending",
      attemptCount: 0,
    });
    expect(outbox!.idempotencyKey).toBe(
      `proposal:${created.proposal.id}:v1:single_delivery`,
    );
    await expect(
      getProposal(db!, "another-owner", created.proposal.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ledgerClaim = await claimIntegrationDelivery(
      db!,
      { runnerId: "ledger-runner", destinations: ["bob"], leaseSeconds: 90 },
      { now: new Date("2026-08-07T16:00:01.000Z") },
    );
    await completeIntegrationDelivery(
      db!,
      {
        outboxId: ledgerClaim!.delivery.id,
        runnerId: "ledger-runner",
        receipt: {
          destination: "bob",
          externalType: "project",
          externalId: "11111111-1111-4111-8111-111111111111",
          deepLink:
            "https://bob.example.com/projects/11111111-1111-4111-8111-111111111111",
          idempotencyKey: ledgerClaim!.delivery.idempotencyKey,
          status: "accepted",
          metadata: {},
          recordedAt: "2026-08-07T16:00:02.000Z",
        },
      },
      { now: new Date("2026-08-07T16:00:02.000Z") },
    );
  });

  it("claims and completes one approved delivery with a durable external link", async () => {
    const conversation = await createConversation(db!, "owner-delivery", {
      title: "Deliver this project",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "delivery-conversation",
    });
    const created = await createProposal(db!, "owner-delivery", {
      conversationId: conversation.conversation.id,
      kind: "bob_project",
      destination: "bob",
      risk: "durable_work",
      preview: {
        name: "Delivery proof",
        acceptanceCriteria: ["One Bob project exists"],
      },
      rationale: "Approved end-to-end proof.",
      confidence: 0.95,
      policySnapshot: { version: "v1" },
      idempotencyKey: "delivery-proposal",
    });
    const approved = await decideProposal(db!, "owner-delivery", {
      proposalId: created.proposal.id,
      decision: "approve",
      expectedVersion: 1,
      scope: "single_delivery",
      decidedAt: "2026-08-07T17:00:00.000Z",
    });
    const claim = await claimIntegrationDelivery(
      db!,
      { runnerId: "delivery-runner", destinations: ["bob"], leaseSeconds: 90 },
      { now: new Date("2026-08-07T17:00:01.000Z") },
    );
    expect(claim).toMatchObject({
      delivery: {
        id: approved.outboxId,
        status: "delivering",
        attemptCount: 1,
      },
      proposal: { id: created.proposal.id, status: "approved" },
    });

    const completed = await completeIntegrationDelivery(
      db!,
      {
        outboxId: claim!.delivery.id,
        runnerId: "delivery-runner",
        receipt: {
          destination: "bob",
          externalType: "project",
          externalId: "22222222-2222-4222-8222-222222222222",
          deepLink:
            "https://bob.example.com/projects/22222222-2222-4222-8222-222222222222",
          idempotencyKey: claim!.delivery.idempotencyKey,
          status: "accepted",
          metadata: { key: "DELIVERY" },
          recordedAt: "2026-08-07T17:00:02.000Z",
        },
      },
      { now: new Date("2026-08-07T17:00:02.000Z") },
    );
    expect(completed).toMatchObject({
      delivery: { status: "delivered" },
      externalLink: {
        proposalId: created.proposal.id,
        externalId: "22222222-2222-4222-8222-222222222222",
      },
    });
    await expect(
      getProposal(db!, "owner-delivery", created.proposal.id),
    ).resolves.toMatchObject({
      status: "delivered",
    });
  });

  it("dead-letters a permanent failure and repairs it without changing approval", async () => {
    const conversation = await createConversation(db!, "owner-repair", {
      title: "Repair delivery",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "repair-conversation",
    });
    const created = await createProposal(db!, "owner-repair", {
      conversationId: conversation.conversation.id,
      kind: "bob_task",
      destination: "bob",
      risk: "durable_work",
      preview: {
        title: "Repair me",
        acceptanceCriteria: ["Repair is replay-safe"],
      },
      rationale: "Delivery repair proof.",
      confidence: 0.9,
      policySnapshot: { version: "v1" },
      idempotencyKey: "repair-proposal",
    });
    await decideProposal(db!, "owner-repair", {
      proposalId: created.proposal.id,
      decision: "approve",
      expectedVersion: 1,
      scope: "single_delivery",
      decidedAt: "2026-08-07T18:00:00.000Z",
    });
    const claim = await claimIntegrationDelivery(
      db!,
      { runnerId: "repair-runner", destinations: ["bob"], leaseSeconds: 90 },
      { now: new Date("2026-08-07T18:00:01.000Z") },
    );
    const failureInput = {
      outboxId: claim!.delivery.id,
      runnerId: "repair-runner",
      classification: "failed" as const,
      error: "Proposal is invalid for the destination",
      retryable: false,
    };
    const failed = await failIntegrationDelivery(db!, failureInput, {
      now: new Date("2026-08-07T18:00:02.000Z"),
    });
    const failureReplay = await failIntegrationDelivery(db!, failureInput, {
      now: new Date("2026-08-07T18:00:03.000Z"),
    });
    expect(failed.delivery.status).toBe("dead_letter");
    expect(failureReplay).toEqual(failed);
    const page = await listDeadLetters(db!, "owner-repair", {
      conversationId: conversation.conversation.id,
      limit: 10,
    });
    expect(page.items).toHaveLength(1);

    const input = {
      deadLetterId: page.items[0]!.id,
      note: "Destination config was corrected.",
      idempotencyKey: "repair-decision-1",
      repairedAt: "2026-08-07T18:01:00.000Z",
    };
    const repaired = await repairDeadLetter(db!, "owner-repair", input);
    const replay = await repairDeadLetter(db!, "owner-repair", input);
    expect(repaired).toMatchObject({
      delivery: { status: "pending" },
      replayed: false,
    });
    expect(replay).toEqual({ ...repaired, replayed: true });
    await expect(
      repairDeadLetter(db!, "not-owner", input),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const claims = await Promise.all([
      claimIntegrationDelivery(
        db!,
        {
          runnerId: "repair-runner-a",
          destinations: ["bob"],
          leaseSeconds: 90,
        },
        { now: new Date("2026-08-07T18:01:01.000Z") },
      ),
      claimIntegrationDelivery(
        db!,
        {
          runnerId: "repair-runner-b",
          destinations: ["bob"],
          leaseSeconds: 90,
        },
        { now: new Date("2026-08-07T18:01:01.000Z") },
      ),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.delivery.id).toBe(repaired.delivery.id);
  });
});

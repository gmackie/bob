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
});

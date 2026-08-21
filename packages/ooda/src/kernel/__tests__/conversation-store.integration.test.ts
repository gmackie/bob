import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { count, eq } from "drizzle-orm";
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
import {
  claimHostTurn,
  completeHostTurn,
  createHostTurn,
  enqueueHostTurn,
} from "../host-turns";
import { HostRoutingError } from "../host-routing";
import { stableStringify } from "../serialization";
import {
  inspectMemory,
  searchMemories,
  submitMemoryFeedback,
} from "../memories";
import {
  createOpportunityReview,
  getAttentionReview,
} from "../opportunity-reviews";
import {
  cancelAgentJob,
  claimAgentJob,
  createAgentJob,
  getAgentJob,
  inspectAgentJobControl,
  recordAgentJobEvent,
} from "../agent-jobs";
import { createProposal, decideProposal, getProposal } from "../proposals";
import { getProductionReadiness } from "../production-readiness";
import {
  claimExternalStatus,
  claimIntegrationDelivery,
  completeExternalStatus,
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
    await applyMigration(migration("0014_puzzling_lady_bullseye.sql"));
    await applyMigration(migration("0015_amazing_hellfire_club.sql"));
    await applyMigration(migration("0016_messy_jack_murdock.sql"));
    await applyMigration(migration("0017_workable_drax.sql"));
    await applyMigration(migration("0018_external_status_reconciliation.sql"));
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
      grantSecret: "0123456789abcdef0123456789abcdef", // gitleaks:allow -- synthetic fixture
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

  it("queues a host turn for a subscription runner and persists its native session", async () => {
    const created = await createConversation(db!, "owner-host-queue", {
      title: "Subscription conversation",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "host-queue-conversation",
    });
    const user = await appendConversationEvent(db!, "owner-host-queue", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-queue" },
      payload: {
        display: "Help me turn this thought into a useful next step.",
      },
      sensitivity: "personal",
      correlationId: "host-queue-proof",
      idempotencyKey: "host-queue-user",
      occurredAt: "2026-08-08T18:00:00.000Z",
    });
    const input = {
      conversationId: created.conversation.id,
      userEventId: user.event.id,
      idempotencyKey: "host-queue-turn",
    };

    const queued = await enqueueHostTurn(db!, "owner-host-queue", input, {
      contextSources: [],
      now: new Date("2026-08-08T18:00:01.000Z"),
    });
    const replay = await enqueueHostTurn(db!, "owner-host-queue", input, {
      contextSources: [],
      now: new Date("2026-08-08T18:00:02.000Z"),
    });
    expect(queued).toMatchObject({ status: "queued", replayed: false });
    expect(replay).toEqual({ ...queued, replayed: true });

    const claim = await claimHostTurn(
      db!,
      {
        runnerId: "runner-host-1",
        providers: ["grok", "claude", "openai"],
        leaseSeconds: 90,
      },
      { now: new Date("2026-08-08T18:00:03.000Z") },
    );
    expect(claim).toMatchObject({
      executionId: queued.executionId,
      preferredProvider: "grok",
      providerOrder: ["grok", "claude", "openai"],
      attempt: 1,
      messages: [
        {
          role: "user",
          content: "Help me turn this thought into a useful next step.",
        },
      ],
    });
    await expect(
      claimHostTurn(
        db!,
        {
          runnerId: "runner-host-2",
          providers: ["grok"],
          leaseSeconds: 90,
        },
        { now: new Date("2026-08-08T18:00:04.000Z") },
      ),
    ).resolves.toBeNull();

    const completed = await completeHostTurn(db!, {
      executionId: queued.executionId,
      runnerId: "runner-host-1",
      leaseToken: claim!.leaseToken,
      provider: "grok",
      model: "grok-subscription-default",
      providerResponseId: "grok-session-1:turn-1",
      response: JSON.stringify({
        display:
          "Start by naming the decision and the smallest reversible test.",
        speakable:
          "Name the decision, then choose the smallest reversible test.",
      }),
      runtimeSession: {
        provider: "grok",
        sessionId: "grok-session-1",
        turnId: "turn-1",
        transport: "acp",
        authMode: "subscription",
      },
      failures: [],
      idempotencyKey: "host-queue-complete-1",
      occurredAt: "2026-08-08T18:00:04.000Z",
    });
    expect(completed).toMatchObject({
      provider: "grok",
      assistantEvent: {
        payload: {
          display:
            "Start by naming the decision and the smallest reversible test.",
        },
      },
    });
    const [execution] = await db!
      .select()
      .from(schema.hostTurnExecutions)
      .where(eq(schema.hostTurnExecutions.id, queued.executionId));
    expect(execution).toMatchObject({
      status: "completed",
      authMode: "subscription",
      nativeSessionId: "grok-session-1",
      nativeTurnId: "turn-1",
      runtimeTransport: "acp",
    });
  });

  it("atomically turns an explicit host draft into one approval-gated Bob proposal", async () => {
    const created = await createConversation(db!, "owner-host-proposal", {
      title: "Conversation to task",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-conversation-host-proposal",
    });
    const user = await appendConversationEvent(db!, "owner-host-proposal", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-host-proposal" },
      payload: {
        display: "Turn our barge-in discussion into a Bob task.",
      },
      sensitivity: "personal",
      correlationId: "host-proposal-proof",
      idempotencyKey: "host-proposal-user-event",
      occurredAt: "2026-08-08T19:00:00.000Z",
    });
    const queued = await enqueueHostTurn(
      db!,
      "owner-host-proposal",
      {
        conversationId: created.conversation.id,
        userEventId: user.event.id,
        idempotencyKey: "host-proposal-turn",
      },
      { now: new Date("2026-08-08T19:00:01.000Z") },
    );
    const claim = await claimHostTurn(
      db!,
      {
        runnerId: "runner-host-proposal",
        providers: ["grok"],
        leaseSeconds: 90,
      },
      { now: new Date("2026-08-08T19:00:02.000Z") },
    );
    expect(claim?.system).toContain('"proposal"');

    const completionInput = {
      executionId: queued.executionId,
      runnerId: "runner-host-proposal",
      leaseToken: claim!.leaseToken,
      provider: "grok" as const,
      model: "grok-subscription-default",
      providerResponseId: "grok-session-proposal:turn-1",
      response: JSON.stringify({
        display: "I drafted the barge-in telemetry task for your review.",
        speakable: "I drafted the task for your review.",
        proposal: {
          kind: "bob_task",
          title: "Add voice barge-in telemetry",
          description: "Measure interruption behavior without retaining audio.",
          acceptanceCriteria: [
            "Record TTS stop latency without raw audio",
            "Link the implementation evidence back to OODA",
          ],
          targetRepo: "/Volumes/dev/bob/bob",
          constraints: ["No raw microphone retention"],
          nonGoals: ["Replacing ElevenLabs"],
          rationale: "The user explicitly asked to create a Bob task.",
          confidence: 0.94,
        },
      }),
      failures: [],
      idempotencyKey: "host-proposal-complete",
      occurredAt: "2026-08-08T19:00:03.000Z",
    };
    const completed = await completeHostTurn(db!, completionInput);
    const replay = await completeHostTurn(db!, completionInput);
    expect(completed.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(completed.assistantEvent.payload).not.toHaveProperty("proposal");

    const storedProposals = await db!
      .select()
      .from(schema.proposals)
      .where(eq(schema.proposals.conversationId, created.conversation.id));
    expect(storedProposals).toHaveLength(1);
    expect(storedProposals[0]).toMatchObject({
      kind: "bob_task",
      destination: "bob",
      risk: "durable_work",
      status: "awaiting_approval",
      preview: {
        title: "Add voice barge-in telemetry",
        acceptanceCriteria: [
          "Record TTS stop latency without raw audio",
          "Link the implementation evidence back to OODA",
        ],
      },
      policySnapshot: {
        version: "host-proposal-v1",
        source: "host_turn",
        sourceEventId: user.event.id,
        assistantEventId: completed.assistantEvent.id,
        approval: {
          required: true,
          scope: "single_delivery",
          inherited: false,
        },
        enforcedBoundary: {
          destination: "bob",
          risk: "durable_work",
        },
      },
    });
    const proposalEvents = await db!
      .select()
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.type, "proposal"));
    expect(
      proposalEvents.filter(
        (event) => event.conversationId === created.conversation.id,
      ),
    ).toHaveLength(1);
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
          expect.objectContaining({
            source: "research-vault",
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

  it("supplies completed branch-visible research as scrubbed context to the next host turn", async () => {
    const created = await createConversation(db!, "owner-research-followup", {
      title: "Continue from research",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "research-followup-conversation",
    });
    const question = await appendConversationEvent(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        branchId: created.branch.id,
        type: "user_turn",
        actor: { type: "user", id: "owner-research-followup" },
        payload: { display: "Research whether this prototype is viable." },
        sensitivity: "personal",
        correlationId: "research-followup-proof",
        idempotencyKey: "research-followup-question",
        occurredAt: "2026-08-07T15:00:00.000Z",
      },
    );
    const createdJob = await createAgentJob(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        sourceEventId: question.event.id,
        class: "read_only_research",
        prompt: "Assess prototype viability.",
        idempotencyKey: "research-followup-job",
      },
    );
    const claim = await claimAgentJob(db!, {
      runnerId: "runner-research-followup",
      providers: ["codex"],
      classes: ["read_only_research"],
      leaseSeconds: 90,
    });
    await recordAgentJobEvent(db!, {
      jobId: createdJob.job.id,
      runnerId: "runner-research-followup",
      leaseToken: claim!.leaseToken,
      type: "completed",
      payload: {
        result: {
          response: `${"The prototype is viable if the first test stays under one week. Bearer research-secret-token ".padEnd(3_998, "x")}Bearer boundary-secret-token`,
        },
      },
      idempotencyKey: "research-followup-complete",
      occurredAt: "2026-08-07T15:01:00.000Z",
    });
    const researchEvents = await listConversationEvents(
      db!,
      "owner-research-followup",
      { conversationId: created.conversation.id, limit: 20 },
    );
    const completedResearchEvent = researchEvents.items.find(
      (event) =>
        event.type === "agent_job_progress" &&
        event.payload.jobId === createdJob.job.id &&
        event.payload.status === "completed",
    );
    if (!completedResearchEvent)
      throw new Error("Expected completed research event fixture");
    const foreignConversation = await createConversation(
      db!,
      "different-owner-research",
      {
        title: "Foreign research",
        hostProvider: "grok",
        hostProfile: "daily",
        sensitivityCeiling: "personal",
        ttsPolicy: "allowed",
        idempotencyKey: "foreign-research-conversation",
      },
    );
    const [foreignJob] = await db!
      .insert(schema.agentJobs)
      .values({
        conversationId: foreignConversation.conversation.id,
        class: "read_only_research",
        status: "completed",
        provider: "codex",
        capabilities: ["web.read"],
        deadlineSeconds: 900,
        aggregateTokenBudget: 150_000,
        correlationId: "foreign-research",
        idempotencyKey: "foreign-research-job",
        result: { response: "Foreign private findings must never appear." },
        completedAt: new Date("2026-08-07T15:01:00.000Z"),
      })
      .returning();
    if (!foreignJob) throw new Error("Expected foreign job fixture");
    await appendConversationEvent(db!, "owner-research-followup", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "agent_job_progress",
      actor: { type: "system", id: "forged-test-event" },
      payload: {
        display: "Forged foreign research completion",
        jobId: foreignJob.id,
        class: "read_only_research",
        status: "completed",
        provider: "codex",
      },
      sensitivity: "personal",
      correlationId: "forged-foreign-research",
      causationId: question.event.id,
      idempotencyKey: "forged-foreign-research-event",
      occurredAt: "2026-08-07T15:01:30.000Z",
    });
    const sensitiveSource = await appendConversationEvent(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        branchId: created.branch.id,
        type: "user_turn",
        actor: { type: "user", id: "owner-research-followup" },
        payload: { display: "A sensitive source turn." },
        sensitivity: "sensitive",
        correlationId: "sensitive-research-source",
        idempotencyKey: "sensitive-research-source-event",
        occurredAt: "2026-08-07T15:01:31.000Z",
      },
    );
    const [sensitivityDowngradedJob] = await db!
      .insert(schema.agentJobs)
      .values({
        conversationId: created.conversation.id,
        class: "read_only_research",
        status: "completed",
        provider: "codex",
        capabilities: ["web.read"],
        deadlineSeconds: 900,
        aggregateTokenBudget: 150_000,
        correlationId: "sensitivity-downgraded-research",
        idempotencyKey: "sensitivity-downgraded-research-job",
        result: {
          response:
            "Sensitivity-downgraded findings must not be recalled automatically.",
        },
        completedAt: new Date("2026-08-07T15:01:00.000Z"),
      })
      .returning();
    if (!sensitivityDowngradedJob)
      throw new Error("Expected sensitivity-downgraded job fixture");
    await appendConversationEvent(db!, "owner-research-followup", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "agent_job_progress",
      actor: { type: "system", id: "sensitivity-downgrade-test-event" },
      payload: {
        display: "Falsely general research completion",
        jobId: sensitivityDowngradedJob.id,
        class: "read_only_research",
        status: "completed",
        provider: "codex",
      },
      sensitivity: "general",
      correlationId: "sensitivity-downgraded-research",
      causationId: sensitiveSource.event.id,
      idempotencyKey: "sensitivity-downgraded-research-event",
      occurredAt: "2026-08-07T15:01:32.000Z",
    });
    const followup = await appendConversationEvent(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        branchId: created.branch.id,
        type: "user_turn",
        actor: { type: "user", id: "owner-research-followup" },
        payload: { display: "What should we do with those findings?" },
        sensitivity: "personal",
        correlationId: "research-followup-proof",
        idempotencyKey: "research-followup-question-two",
        occurredAt: "2026-08-07T15:02:00.000Z",
      },
    );
    const queued = await enqueueHostTurn(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        userEventId: followup.event.id,
        idempotencyKey: "research-followup-host-turn",
      },
      {
        now: new Date("2026-08-07T15:02:01.000Z"),
      },
    );
    const hostClaim = await claimHostTurn(
      db!,
      {
        runnerId: "runner-research-host",
        providers: ["grok"],
        leaseSeconds: 90,
      },
      { now: new Date("2026-08-07T15:02:02.000Z") },
    );
    const receivedSystem = hostClaim!.system;

    expect(receivedSystem).toContain(
      "The prototype is viable if the first test stays under one week.",
    );
    expect(receivedSystem).toContain("[REDACTED CREDENTIAL]");
    expect(receivedSystem).not.toContain("research-secret-token");
    expect(receivedSystem).not.toContain("boundary-secret-token");
    expect(receivedSystem).not.toContain("Foreign private findings");
    expect(receivedSystem).not.toContain("Sensitivity-downgraded findings");
    const items = await db!
      .select()
      .from(schema.contextItems)
      .where(eq(schema.contextItems.contextPackId, queued.contextPackId!));
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "conversation_event",
          sourceId: completedResearchEvent.id,
          sensitivity: "personal",
          decision: "redacted",
        }),
      ]),
    );

    const sibling = await forkConversation(db!, "owner-research-followup", {
      conversationId: created.conversation.id,
      parentBranchId: created.branch.id,
      forkEventId: question.event.id,
      name: "without-later-research",
      reason: "Prove post-fork research does not cross branch boundaries",
      idempotencyKey: "research-followup-sibling-fork",
    });
    const siblingQuestion = await appendConversationEvent(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        branchId: sibling.branch.id,
        type: "user_turn",
        actor: { type: "user", id: "owner-research-followup" },
        payload: { display: "What do we know on this branch?" },
        sensitivity: "personal",
        correlationId: "research-followup-sibling-proof",
        idempotencyKey: "research-followup-sibling-question",
        occurredAt: "2026-08-07T15:03:00.000Z",
      },
    );
    let siblingSystem = "";
    await createHostTurn(
      db!,
      "owner-research-followup",
      {
        conversationId: created.conversation.id,
        userEventId: siblingQuestion.event.id,
        idempotencyKey: "research-followup-sibling-host-turn",
      },
      {
        providers: [
          {
            id: "grok",
            complete: ({ system }) => {
              siblingSystem = system;
              return Promise.resolve({
                providerResponseId: "research-followup-sibling-response",
                model: "grok-4.5",
                text: '{"display":"No later findings are visible here.","speakable":"No later findings are visible here."}',
              });
            },
          },
        ],
      },
    );
    expect(siblingSystem).not.toContain("The prototype is viable");
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
      occurredAt: "2026-08-05T18:00:00Z",
    };

    const first = await appendConversationEvent(db!, "owner-a", input);
    const replay = await appendConversationEvent(db!, "owner-a", input);

    expect(replay).toEqual({ event: first.event, replayed: true });
    const captured = await db!
      .select()
      .from(schema.memorySeeds)
      .where(eq(schema.memorySeeds.sourceEventId, first.event.id));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      normalizedText: "Remember this",
      lifecycleState: "captured",
    });
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

  it("persists an event-only user turn without deriving a memory seed", async () => {
    const created = await createConversation(db!, "owner-a", {
      title: "Hermes inbox",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "create-hermes-inbox",
    });
    const input = {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn" as const,
      actor: { type: "user" as const },
      payload: { format: "text", text: "One event only", source: "hermes" },
      sensitivity: "personal" as const,
      correlationId: "telegram:4512:9918",
      idempotencyKey: "telegram:4512:9918",
      occurredAt: "2026-08-21T13:30:00.000Z",
    };

    const first = await appendConversationEvent(db!, "owner-a", input, { captureMemory: false });
    const replay = await appendConversationEvent(db!, "owner-a", input, { captureMemory: false });
    const captured = await db!.select().from(schema.memorySeeds)
      .where(eq(schema.memorySeeds.sourceEventId, first.event.id));

    expect(first.event.type).toBe("user_turn");
    expect(replay).toEqual({ event: first.event, replayed: true });
    expect(captured).toEqual([]);
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

    const seeds = await db!
      .select()
      .from(schema.memorySeeds)
      .where(eq(schema.memorySeeds.conversationId, created.conversation.id));
    const originalSeed = seeds.find(
      (seed) => seed.sourceEventId === original.event.id,
    );
    const correctionSeed = seeds.find(
      (seed) => seed.sourceEventId === correction.event.id,
    );
    expect(correctionSeed).toMatchObject({
      kind: "correction",
      normalizedText: "recipe idea",
    });
    expect(originalSeed?.supersededById).toBe(correctionSeed?.id);

    const search = await searchMemories(db!, "owner-a", {
      query: "recipe",
      includeSuperseded: false,
      limit: 10,
    });
    expect(search.items.map((memory) => memory.id)).toEqual([
      correctionSeed!.id,
    ]);

    const detail = await inspectMemory(db!, "owner-a", correctionSeed!.id);
    expect(detail.connections).toHaveLength(1);
    expect(detail.connections[0]).toMatchObject({
      direction: "outgoing",
      edge: { kind: "supersedes", feedbackState: "confirmed" },
      memory: { id: originalSeed!.id },
    });

    const feedbackInput = {
      edgeId: detail.connections[0]!.edge.id,
      feedbackState: "suppressed" as const,
      idempotencyKey: "suppress-correction-edge",
    };
    const feedback = await submitMemoryFeedback(db!, "owner-a", feedbackInput);
    const feedbackReplay = await submitMemoryFeedback(
      db!,
      "owner-a",
      feedbackInput,
    );
    expect(feedback).toMatchObject({
      edge: { feedbackState: "suppressed" },
      replayed: false,
    });
    expect(feedbackReplay).toMatchObject({ replayed: true });
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
    const source = await appendConversationEvent(db!, "owner-jobs", {
      conversationId: conversation.conversation.id,
      branchId: conversation.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-jobs" },
      payload: { display: "Compare the two implementation approaches." },
      sensitivity: "personal",
      correlationId: "research-source-turn",
      idempotencyKey: "research-source-event",
      occurredAt: "2026-08-07T14:59:00.000Z",
    });
    const fork = await forkConversation(db!, "owner-jobs", {
      conversationId: conversation.conversation.id,
      parentBranchId: conversation.branch.id,
      forkEventId: source.event.id,
      name: "different-active-branch",
      reason: "Prove research remains anchored to its source turn",
      idempotencyKey: "research-source-branch-fork",
    });
    expect(fork.branch.id).not.toBe(source.event.branchId);
    const input = {
      conversationId: conversation.conversation.id,
      sourceEventId: source.event.id,
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
    const conversationPage = await listConversationEvents(db!, "owner-jobs", {
      conversationId: conversation.conversation.id,
      limit: 10,
    });
    expect(conversationPage.items).toEqual([
      expect.objectContaining({ id: source.event.id }),
      expect.objectContaining({
        type: "agent_job_progress",
        branchId: source.event.branchId,
        sensitivity: "personal",
        causationId: source.event.id,
        correlationId: "research-job-1",
        payload: expect.objectContaining({
          jobId: created.job.id,
          class: "read_only_research",
          status: "queued",
        }),
      }),
    ]);

    const claim = await claimAgentJob(db!, {
      runnerId: "runner-a",
      providers: ["codex"],
      classes: ["read_only_research"],
      leaseSeconds: 90,
    });
    expect(claim).toMatchObject({
      job: { id: created.job.id, status: "running" },
      prompt: input.prompt,
      attempt: 1,
      contextItems: [],
    });
    expect(claim?.leaseToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const completed = await recordAgentJobEvent(db!, {
      jobId: created.job.id,
      runnerId: "runner-a",
      leaseToken: claim!.leaseToken,
      type: "completed",
      payload: {
        result: {
          response: "Approach A is lower risk.",
          artifactRef: "scratch://research-job-1/report.md",
          runtimeSession: { sessionId: "must-not-leak-through-result" },
        },
        tokensUsed: 42,
      },
      idempotencyKey: "runner-complete-1",
      occurredAt: "2026-08-07T15:00:00.000Z",
    });
    const eventReplay = await recordAgentJobEvent(db!, {
      jobId: created.job.id,
      runnerId: "runner-a",
      leaseToken: claim!.leaseToken,
      type: "completed",
      payload: {
        result: {
          response: "Approach A is lower risk.",
          artifactRef: "scratch://research-job-1/report.md",
          runtimeSession: { sessionId: "must-not-leak-through-result" },
        },
        tokensUsed: 42,
      },
      idempotencyKey: "runner-complete-1",
      occurredAt: "2026-08-07T15:00:00.000Z",
    });
    expect(completed.job).toMatchObject({
      status: "completed",
      result: {
        response: "Approach A is lower risk.",
        artifactRef: "scratch://research-job-1/report.md",
      },
    });
    expect(completed.job.result).not.toHaveProperty("runtimeSession");
    expect(eventReplay).toEqual({ ...completed, replayed: true });
    await expect(
      createAgentJob(db!, "owner-jobs", {
        conversationId: conversation.conversation.id,
        sourceEventId: conversationPage.items[1]!.id,
        class: "read_only_research",
        prompt: "This progress card is not a valid source turn.",
        idempotencyKey: "research-invalid-source-event",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    const sensitiveSource = await appendConversationEvent(
      db!,
      "owner-jobs",
      {
        conversationId: conversation.conversation.id,
        branchId: fork.branch.id,
        type: "user_turn",
        actor: { type: "user", id: "owner-jobs" },
        payload: { display: "A sensitive detail requiring disclosure approval." },
        sensitivity: "sensitive",
        correlationId: "research-sensitive-source",
        idempotencyKey: "research-sensitive-source-event",
        occurredAt: "2026-08-07T15:01:00.000Z",
      },
    );
    await expect(
      createAgentJob(db!, "owner-jobs", {
        conversationId: conversation.conversation.id,
        sourceEventId: sensitiveSource.event.id,
        class: "read_only_research",
        prompt: "This must not leave the trusted environment automatically.",
        idempotencyKey: "research-sensitive-source-job",
      }),
    ).rejects.toMatchObject({
      code: "CONTEXT_DISCLOSURE_DENIED",
      status: 403,
    });
    const lifecyclePage = await listConversationEvents(db!, "owner-jobs", {
      conversationId: conversation.conversation.id,
      limit: 10,
    });
    expect(
      lifecyclePage.items
        .filter((event) => event.type === "agent_job_progress")
        .map((event) => ({
        type: event.type,
        status: event.payload.status,
        jobId: event.payload.jobId,
        branchId: event.branchId,
        sensitivity: event.sensitivity,
        causationId: event.causationId,
      })),
    ).toEqual([
      {
        type: "agent_job_progress",
        status: "queued",
        jobId: created.job.id,
        branchId: source.event.branchId,
        sensitivity: "personal",
        causationId: source.event.id,
      },
      {
        type: "agent_job_progress",
        status: "running",
        jobId: created.job.id,
        branchId: source.event.branchId,
        sensitivity: "personal",
        causationId: source.event.id,
      },
      {
        type: "agent_job_progress",
        status: "completed",
        jobId: created.job.id,
        branchId: source.event.branchId,
        sensitivity: "personal",
        causationId: source.event.id,
      },
    ]);
    await expect(
      getAgentJob(db!, "another-owner", created.job.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scopes runner claims by owner and cancels active work when rollout eligibility is removed", async () => {
    const deniedConversation = await createConversation(db!, "owner-denied", {
      title: "Must stay queued",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "jobs-rollout-denied-conversation",
    });
    const denied = await createAgentJob(db!, "owner-denied", {
      conversationId: deniedConversation.conversation.id,
      class: "read_only_research",
      prompt: "Do not claim this job during the rollout.",
      idempotencyKey: "jobs-rollout-denied-job",
    });
    const allowedConversation = await createConversation(db!, "owner-allowed", {
      title: "May run during rollout",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "jobs-rollout-allowed-conversation",
    });
    const allowed = await createAgentJob(db!, "owner-allowed", {
      conversationId: allowedConversation.conversation.id,
      class: "read_only_research",
      prompt: "Run this bounded rollout proof.",
      idempotencyKey: "jobs-rollout-allowed-job",
    });
    const claimedAt = new Date();
    const claimInput = {
      runnerId: "runner-rollout",
      providers: ["codex"],
      classes: ["read_only_research" as const],
      leaseSeconds: 90,
    };

    await expect(
      claimAgentJob(db!, claimInput, {
        now: claimedAt,
        eligibleOwnerIds: [],
      }),
    ).resolves.toBeNull();
    const claim = await claimAgentJob(db!, claimInput, {
      now: claimedAt,
      eligibleOwnerIds: ["owner-allowed"],
    });
    expect(claim?.job.id).toBe(allowed.job.id);
    await expect(
      getAgentJob(db!, "owner-denied", denied.job.id),
    ).resolves.toMatchObject({ status: "queued" });
    await cancelAgentJob(db!, "owner-denied", {
      jobId: denied.job.id,
      idempotencyKey: "jobs-rollout-denied-cleanup",
    });

    const killedAt = new Date(claimedAt.getTime() + 1_000);
    const firstControl = await inspectAgentJobControl(
      db!,
      {
        jobId: allowed.job.id,
        runnerId: claimInput.runnerId,
        leaseToken: claim!.leaseToken,
      },
      { now: killedAt, eligibleOwnerIds: [] },
    );
    expect(firstControl).toMatchObject({
      status: "running",
      cancelRequested: true,
      attempt: 1,
    });
    expect(firstControl.leaseExpiresAt).toBe(
      new Date(claimedAt.getTime() + 90_000).toISOString(),
    );
    await expect(
      recordAgentJobEvent(db!, {
        jobId: allowed.job.id,
        runnerId: claimInput.runnerId,
        leaseToken: claim!.leaseToken,
        type: "progress",
        payload: { display: "Buffered after cancellation" },
        idempotencyKey: "jobs-rollout-late-progress",
        occurredAt: new Date(killedAt.getTime() + 250).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(
      recordAgentJobEvent(db!, {
        jobId: allowed.job.id,
        runnerId: claimInput.runnerId,
        leaseToken: claim!.leaseToken,
        type: "completed",
        payload: { result: { response: "Late success" } },
        idempotencyKey: "jobs-rollout-late-completed",
        occurredAt: new Date(killedAt.getTime() + 500).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const secondControl = await inspectAgentJobControl(
      db!,
      {
        jobId: allowed.job.id,
        runnerId: claimInput.runnerId,
        leaseToken: claim!.leaseToken,
      },
      {
        now: new Date(killedAt.getTime() + 1_000),
        eligibleOwnerIds: [],
      },
    );
    expect(secondControl.cancelRequested).toBe(true);
    const [cancellationEvents] = await db!
      .select({ value: count() })
      .from(schema.agentJobEvents)
      .where(
        eq(
          schema.agentJobEvents.idempotencyKey,
          `rollout-cancel:${allowed.job.id}`,
        ),
      );
    expect(cancellationEvents?.value).toBe(1);

    await expect(
      recordAgentJobEvent(db!, {
        jobId: allowed.job.id,
        runnerId: claimInput.runnerId,
        leaseToken: claim!.leaseToken,
        type: "cancelled",
        payload: { reason: "Rollout disabled" },
        idempotencyKey: "jobs-rollout-runner-cancelled",
        occurredAt: new Date(killedAt.getTime() + 2_000).toISOString(),
      }),
    ).resolves.toMatchObject({ job: { status: "cancelled" } });
  });

  it("freezes provider-specific disclosure before a job is claimed", async () => {
    const conversation = await createConversation(db!, "owner-job-context", {
      title: "Research with project context",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "job-context-conversation",
    });
    const created = await createAgentJob(
      db!,
      "owner-job-context",
      {
        conversationId: conversation.conversation.id,
        class: "read_only_research",
        prompt: "Review current implementation evidence",
        idempotencyKey: "job-context-create",
      },
      {
        now: new Date("2026-08-08T15:00:00.000Z"),
        contextSources: [
          {
            id: "forgegraph",
            inspect: () =>
              Promise.resolve([
                {
                  sourceType: "forgegraph_changeset" as const,
                  sourceId: "changeset-1",
                  sensitivity: "general" as const,
                  content: "CI passed for the OODA runtime changes.",
                },
                {
                  sourceType: "forgegraph_changeset" as const,
                  sourceId: "changeset-sensitive",
                  sensitivity: "sensitive" as const,
                  content: "secret deployment evidence",
                },
              ]),
          },
        ],
      },
    );

    expect(created.job.contextPackId).toBeTruthy();
    const [pack] = await db!
      .select()
      .from(schema.contextPacks)
      .where(eq(schema.contextPacks.id, created.job.contextPackId!));
    expect(pack).toMatchObject({
      provider: "codex",
      purpose: "agent_job",
    });

    const claim = await claimAgentJob(db!, {
      runnerId: "runner-context",
      providers: ["codex"],
      classes: ["read_only_research"],
      leaseSeconds: 90,
    });
    expect(claim?.contextItems).toEqual([
      expect.objectContaining({
        sourceId: "changeset-1",
        decision: "disclosed",
        content: "CI passed for the OODA runtime changes.",
      }),
      expect.objectContaining({
        sourceId: "changeset-sensitive",
        decision: "denied",
      }),
    ]);
    expect(claim?.contextItems[1]).not.toHaveProperty("content");
  });

  it("reclaims an expired job and fences the stale runner lease", async () => {
    const conversation = await createConversation(db!, "owner-job-lease", {
      title: "Recover abandoned work",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "job-lease-conversation",
    });
    const created = await createAgentJob(db!, "owner-job-lease", {
      conversationId: conversation.conversation.id,
      class: "read_only_research",
      prompt: "Recover this research job",
      idempotencyKey: "job-lease-create",
    });
    const first = await claimAgentJob(
      db!,
      {
        runnerId: "runner-old",
        providers: ["codex"],
        classes: ["read_only_research"],
        leaseSeconds: 30,
      },
      { now: new Date("2026-08-08T15:00:00.000Z") },
    );
    const second = await claimAgentJob(
      db!,
      {
        runnerId: "runner-new",
        providers: ["codex"],
        classes: ["read_only_research"],
        leaseSeconds: 90,
      },
      { now: new Date("2026-08-08T15:00:31.000Z") },
    );

    expect(second).toMatchObject({
      job: { id: created.job.id },
      attempt: 2,
    });
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    await expect(
      recordAgentJobEvent(db!, {
        jobId: created.job.id,
        runnerId: "runner-old",
        leaseToken: first!.leaseToken,
        type: "completed",
        payload: { result: { summary: "stale result" } },
        idempotencyKey: "stale-runner-complete",
        occurredAt: "2026-08-08T15:00:32.000Z",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(
      inspectAgentJobControl(db!, {
        jobId: created.job.id,
        runnerId: "runner-old",
        leaseToken: first!.leaseToken,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await recordAgentJobEvent(db!, {
      jobId: created.job.id,
      runnerId: "runner-new",
      leaseToken: second!.leaseToken,
      type: "completed",
      payload: { result: { summary: "reclaimed result" } },
      idempotencyKey: "new-runner-complete",
      occurredAt: "2026-08-08T15:00:33.000Z",
    });
  });

  it("finalizes an abandoned cancellation instead of re-running the job", async () => {
    const conversation = await createConversation(db!, "owner-job-cancel", {
      title: "Cancel abandoned work",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "job-cancel-conversation",
    });
    const created = await createAgentJob(db!, "owner-job-cancel", {
      conversationId: conversation.conversation.id,
      class: "read_only_research",
      prompt: "Stop this job",
      idempotencyKey: "job-cancel-create",
    });
    await claimAgentJob(
      db!,
      {
        runnerId: "runner-cancel-old",
        providers: ["codex"],
        classes: ["read_only_research"],
        leaseSeconds: 30,
      },
      { now: new Date("2026-08-08T16:00:00.000Z") },
    );
    await cancelAgentJob(db!, "owner-job-cancel", {
      jobId: created.job.id,
      idempotencyKey: "job-cancel-request",
    });

    const reclaimed = await claimAgentJob(
      db!,
      {
        runnerId: "runner-cancel-new",
        providers: ["codex"],
        classes: ["read_only_research"],
        leaseSeconds: 90,
      },
      { now: new Date("2026-08-08T16:00:31.000Z") },
    );

    expect(reclaimed).toBeNull();
    await expect(
      getAgentJob(db!, "owner-job-cancel", created.job.id),
    ).resolves.toMatchObject({ status: "cancelled" });
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
    const [packsBeforeRejection] = await db!
      .select({ value: count() })
      .from(schema.contextPacks);
    await expect(
      createAgentJob(
        db!,
        "owner-capacity",
        {
          conversationId: conversation.conversation.id,
          class: "read_only_research",
          prompt: "This fourth lane must wait.",
          idempotencyKey: "capacity-job-3",
        },
        { contextSources: [] },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    const [packsAfterRejection] = await db!
      .select({ value: count() })
      .from(schema.contextPacks);
    expect(packsAfterRejection?.value).toBe(packsBeforeRejection?.value);

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

  it("gates a BizPulse venture on a complete, capacity-aware opportunity review", async () => {
    const conversation = await createConversation(db!, "owner-opportunity", {
      title: "Evaluate a venture",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "opportunity-conversation",
    });
    const turn = await appendConversationEvent(db!, "owner-opportunity", {
      conversationId: conversation.conversation.id,
      branchId: conversation.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-opportunity" },
      payload: {
        display:
          "What if OODA turned good conversations into well-scoped work?",
      },
      sensitivity: "personal",
      correlationId: "opportunity-proof",
      idempotencyKey: "opportunity-turn",
      occurredAt: "2026-08-08T17:00:00.000Z",
    });
    const [seed] = await db!
      .select()
      .from(schema.memorySeeds)
      .where(eq(schema.memorySeeds.sourceEventId, turn.event.id));
    expect(seed).toBeDefined();

    const opportunity = {
      problem: "Ideas get lost before they become appropriately scoped work.",
      audience: "A single operator managing several technical ventures.",
      currentWorkaround:
        "Manually copy chat notes into several project systems.",
      differentiation:
        "Preserve conversational provenance through approved execution.",
      evidence: [
        "The operator already uses OODA, Bob, KanBanger, and BizPulse.",
      ],
      strategicFit:
        "This is the central promise of the OODA personal operating system.",
      smallestTest: "Ship one approved conversation-to-project flow.",
      effort: "One focused implementation stream.",
      risks: ["Too much automation could create unwanted commitments."],
      killCriteria: [
        "The flow duplicates durable objects or loses provenance.",
      ],
    };
    const reviewInput = {
      memorySeedId: seed!.id,
      dimensionScores: {
        expectedValue: 1,
        strategicFit: 1,
        evidence: 0.8,
        timing: 0.8,
        crossProjectSynergy: 0.9,
        energyInterestFit: 0.9,
        reversibilityLearningValue: 0.9,
        opportunityCost: 0.2,
      },
      uncertainty: 0.15,
      capacitySnapshot: {
        activeVentureExperiments: 1,
        majorImplementationStreams: 1,
        dailyRecommendedActions: 2,
      },
      opportunity,
      idempotencyKey: "opportunity-review-1",
    };
    const reviewed = await createOpportunityReview(
      db!,
      "owner-opportunity",
      reviewInput,
    );
    const replay = await createOpportunityReview(
      db!,
      "owner-opportunity",
      reviewInput,
    );

    expect(reviewed).toMatchObject({
      replayed: false,
      review: { overallScore: 0.87, recommendation: "propose", opportunity },
    });
    expect(replay).toEqual({ ...reviewed, replayed: true });
    await expect(
      getAttentionReview(db!, "owner-opportunity", reviewed.review.id),
    ).resolves.toEqual(reviewed.review);
    await expect(
      getAttentionReview(db!, "another-owner", reviewed.review.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    await expect(
      createProposal(db!, "owner-opportunity", {
        conversationId: conversation.conversation.id,
        kind: "bizpulse_venture",
        destination: "bizpulse",
        risk: "durable_work",
        preview: { name: "Conversation-to-work" },
        rationale: "Promote the reviewed opportunity.",
        confidence: 0.87,
        policySnapshot: { version: "proposal-policy-v1" },
        idempotencyKey: "incomplete-venture-proposal",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });

    const proposed = await createProposal(db!, "owner-opportunity", {
      conversationId: conversation.conversation.id,
      kind: "bizpulse_venture",
      destination: "bizpulse",
      risk: "durable_work",
      preview: {
        name: "Conversation-to-work",
        opportunityReviewId: reviewed.review.id,
        ...opportunity,
      },
      rationale: "Promote the reviewed opportunity.",
      confidence: 0.87,
      policySnapshot: { version: "proposal-policy-v1" },
      idempotencyKey: "venture-proposal-1", // gitleaks:allow -- not a credential
    });
    expect(proposed.proposal.status).toBe("awaiting_approval");
    const [proposedSeed] = await db!
      .select()
      .from(schema.memorySeeds)
      .where(eq(schema.memorySeeds.id, seed!.id));
    expect(proposedSeed?.lifecycleState).toBe("proposed");

    const approved = await decideProposal(db!, "owner-opportunity", {
      proposalId: proposed.proposal.id,
      decision: "approve",
      expectedVersion: 1,
      scope: "single_delivery",
      decidedAt: "2026-08-08T17:05:00.000Z",
    });
    expect(approved.outboxId).toBeDefined();
    const [committedSeed] = await db!
      .select()
      .from(schema.memorySeeds)
      .where(eq(schema.memorySeeds.id, seed!.id));
    expect(committedSeed?.lifecycleState).toBe("committed");
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

    const statusClaim = await claimExternalStatus(
      db!,
      { runnerId: "status-runner", destinations: ["bob"], leaseSeconds: 90 },
      {
        now: new Date("2099-08-07T17:01:00.000Z"),
        ownerEligible: (ownerId) => ownerId === "owner-delivery",
      },
    );
    expect(statusClaim?.link.id).toBe(completed.externalLink?.id);
    const evidence = {
      id: "forgegraph_build:build-1",
      source: "forgegraph",
      kind: "build",
      externalId: "build-1",
      title: "ForgeGraph build",
      status: "passed",
      deepLink: "https://bob.example.com/work-items/task-1",
      occurredAt: "2099-08-07T17:00:30.000Z",
      metadata: { imageDigest: "sha256:abc" },
    };
    const observed = await completeExternalStatus(
      db!,
      {
        externalLinkId: statusClaim!.link.id,
        runnerId: "status-runner",
        status: {
          status: "active",
          observedAt: "2099-08-07T17:01:01.000Z",
          metadata: { workItemStatus: "in_progress" },
          evidence: [evidence],
        },
      },
      { now: new Date("2099-08-07T17:01:01.000Z"), intervalSeconds: 60 },
    );
    expect(observed.newEvidenceCount).toBe(1);

    const replayClaim = await claimExternalStatus(
      db!,
      { runnerId: "status-runner", destinations: ["bob"], leaseSeconds: 90 },
      {
        now: new Date("2099-08-07T17:02:02.000Z"),
        ownerEligible: (ownerId) => ownerId === "owner-delivery",
      },
    );
    const replayed = await completeExternalStatus(
      db!,
      {
        externalLinkId: replayClaim!.link.id,
        runnerId: "status-runner",
        status: {
          status: "active",
          observedAt: "2099-08-07T17:02:02.000Z",
          metadata: {},
          evidence: [evidence],
        },
      },
      { now: new Date("2099-08-07T17:02:02.000Z") },
    );
    expect(replayed.newEvidenceCount).toBe(0);
    const evidenceEvents = await listConversationEvents(db!, "owner-delivery", {
      conversationId: conversation.conversation.id,
      limit: 100,
    });
    expect(
      evidenceEvents.items.filter(
        (event) => event.type === "external_evidence",
      ),
    ).toHaveLength(1);
  });

  it("skips rollout-ineligible deliveries without starving an eligible owner", async () => {
    const createApproved = async (
      ownerId: string,
      idempotencySuffix: string,
      decidedAt: string,
    ) => {
      const conversation = await createConversation(db!, ownerId, {
        title: `Delivery guard ${ownerId}`,
        hostProvider: "grok",
        hostProfile: "daily",
        sensitivityCeiling: "personal",
        ttsPolicy: "allowed",
        idempotencyKey: `delivery-guard-conversation-${idempotencySuffix}`,
      });
      const created = await createProposal(db!, ownerId, {
        conversationId: conversation.conversation.id,
        kind: "bob_project",
        destination: "bob",
        risk: "durable_work",
        preview: {
          name: `Guarded ${ownerId}`,
          acceptanceCriteria: ["Only rollout-eligible work is claimed"],
        },
        rationale: "Prove owner rollout eligibility at claim time.",
        confidence: 0.9,
        policySnapshot: { version: "v1" },
        idempotencyKey: `delivery-guard-proposal-${idempotencySuffix}`,
      });
      return decideProposal(db!, ownerId, {
        proposalId: created.proposal.id,
        decision: "approve",
        expectedVersion: 1,
        scope: "single_delivery",
        decidedAt,
      });
    };

    const denied = [];
    for (let index = 0; index < 21; index += 1) {
      denied.push(
        await createApproved(
          `owner-delivery-denied-${index}`,
          `denied-${index}`,
          `2026-08-11T18:10:${String(index).padStart(2, "0")}.000Z`,
        ),
      );
    }
    const eligible = await createApproved(
      "owner-delivery-eligible",
      "eligible",
      "2026-08-11T18:10:30.000Z",
    );

    const claim = await claimIntegrationDelivery(
      db!,
      { runnerId: "guard-runner", destinations: ["bob"], leaseSeconds: 90 },
      {
        now: new Date("2026-08-11T18:10:31.000Z"),
        eligibleOwnerIds: ["owner-delivery-eligible"],
        ownerEligible: (ownerId, proposal) =>
          ownerId === "owner-delivery-eligible" &&
          proposal.kind === "bob_project",
      },
    );
    expect(claim?.delivery.id).toBe(eligible.outboxId);
    expect(denied.map(({ outboxId }) => outboxId)).not.toContain(
      claim?.delivery.id,
    );

    await expect(
      claimIntegrationDelivery(
        db!,
        {
          runnerId: "guard-runner-2",
          destinations: ["bob"],
          leaseSeconds: 90,
        },
        {
          now: new Date("2026-08-11T18:10:32.000Z"),
          ownerEligible: () => false,
        },
      ),
    ).resolves.toBeNull();
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

  it("computes an owner-scoped production readiness snapshot from canonical records", async () => {
    const created = await createConversation(db!, "owner-readiness", {
      title: "Dogfood proof",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      idempotencyKey: "readiness-conversation",
    });
    const user = await appendConversationEvent(db!, "owner-readiness", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "user_turn",
      actor: { type: "user", id: "owner-readiness" },
      payload: { display: "Is this durable?" },
      sensitivity: "general",
      correlationId: "readiness-turn",
      idempotencyKey: "readiness-user",
      occurredAt: "2099-08-10T12:00:00.000Z",
    });
    await appendConversationEvent(db!, "owner-readiness", {
      conversationId: created.conversation.id,
      branchId: created.branch.id,
      type: "assistant_turn",
      actor: { type: "host", id: "grok" },
      payload: { display: "Yes." },
      sensitivity: "general",
      correlationId: "readiness-turn",
      causationId: user.event.id,
      idempotencyKey: "readiness-assistant",
      occurredAt: "2099-08-10T12:00:01.000Z",
    });

    const snapshot = await getProductionReadiness(db!, "owner-readiness", {
      now: new Date("2099-08-23T12:00:00.000Z"),
      env: {
        NODE_ENV: "production",
        OODA_ROLLOUT_STAGE: "reviews_push",
        OODA_ROLLOUT_OWNER_IDS: "owner-readiness",
        OODA_DOGFOOD_STARTED_AT: "2099-08-09T12:00:00.000Z",
        OODA_OFFLINE_RECONCILIATION_CONFIRMED_AT: "2099-08-10T12:00:00.000Z",
        OODA_MOBILE_DAILY_DRIVER_CONFIRMED_AT: "2099-08-20T12:00:00.000Z",
      },
    });

    expect(snapshot).toMatchObject({
      dogfoodElapsedDays: 14,
      acceptedTurnCount: 1,
      unresolvedTurnCount: 0,
      externalWriteCount: 0,
      ready: false,
    });
    expect(
      snapshot.gates.find((gate) => gate.id === "external_write_lineage")
        ?.status,
    ).toBe("pending");
  });
});

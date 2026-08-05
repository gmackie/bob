import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const DATABASE_URL = process.env.OODA_KERNEL_TEST_DATABASE_URL;
const HAS_DB = Boolean(DATABASE_URL);

const sql = HAS_DB ? postgres(DATABASE_URL!, { max: 20 }) : null;
const db = sql
  ? drizzle({ client: sql, schema, casing: "snake_case" })
  : null;

function migration(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../drizzle/${name}`, import.meta.url)),
    "utf8",
  );
}

async function applyMigration(source: string) {
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) await sql!.unsafe(statement);
  }
}

describe.skipIf(!HAS_DB)("OODA conversation store", () => {
  beforeAll(async () => {
    await sql!`drop schema if exists ooda cascade`;
    await applyMigration(migration("0006_clean_viper.sql"));
    await applyMigration(migration("0007_wet_surge.sql"));
    await applyMigration(migration("0008_ooda_kernel_idempotency.sql"));
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

    expect(sequences).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(new Set(sequences)).toHaveLength(24);
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
      Array.from({ length: 12 }, () => appendConversationEvent(db!, "owner-a", input)),
    );

    expect(new Set(results.map(({ event }) => event.id))).toHaveLength(1);
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect((await getConversation(db!, "owner-a", created.conversation.id)).conversation.lastSequence).toBe("1");
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
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toHaveLength(3);

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

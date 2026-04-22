// Task 10 tests for AgentSession.sendTurn — per-turn transcript persistence,
// role mapping, status transitions, resume-session propagation, and the two
// tagged errors (AgentSessionNotFoundError, TurnInProgressError).
//
// Test design note: each test constructs its own layer inside the test body
// because `layerAgent(adapter)` captures the adapter in a closure — different
// tests want different adapters (plain mock, spy-wrapped, delayed). Building
// the layer per test is cleaner than threading a Ref through the service.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Stream, Layer, Exit } from "effect";
import { asc, eq } from "drizzle-orm";

import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import {
  chatConversations,
  chatMessages,
} from "@gmacko/db/schema/sessions";
import { tenants } from "@gmacko/db/schema/tenancy";
import { users } from "@gmacko/db/schema/auth";
import type { TenantId, UserId } from "@gmacko/validators";

import {
  AgentSession,
  AgentSessionNotFoundError,
  layerAgent,
} from "../agent-session.js";
import { mockAdapter } from "../mock-adapter.js";
import type {
  AdapterTurnInput,
  AgentAdapter,
  AgentEvent,
} from "../adapter.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const TENANT_A = "00000000-0000-0000-0000-00000000000a" as TenantId;
const TENANT_B = "00000000-0000-0000-0000-00000000000b" as TenantId;
const USER_ID = "user_send_turn_abc" as UserId;

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestDb();
  await ctx.db.insert(tenants).values([
    { id: TENANT_A, name: "Tenant A", slug: "tenant-a" },
    { id: TENANT_B, name: "Tenant B", slug: "tenant-b" },
  ]);
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "Send Turn User",
    email: "send-turn@example.com",
  });
});

afterEach(async () => {
  await ctx.teardown();
});

const buildLayer = (adapter: AgentAdapter) =>
  Layer.provide(layerAgent(adapter), layerGmackoDb(ctx.db));

describe("@gmacko/agent AgentSession.sendTurn", () => {
  it.effect(
    "persists user + assistant transcript rows, transitions status to completed, and records externalSessionId",
    () =>
      Effect.gen(function* () {
        const events: AgentEvent[] = [
          { type: "session_init", externalSessionId: "ext-1", model: "sonnet" },
          { type: "turn_start" },
          { type: "text_delta", text: "Hello" },
          { type: "text_delta", text: " world" },
          { type: "turn_end", stopReason: "end_turn" },
        ];
        const adapter = mockAdapter({ events });
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        const collected = yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* svc.sendTurn({
              conversationId,
              tenantId: TENANT_A,
              userId: USER_ID,
              prompt: "hi",
            });
            return yield* Stream.runCollect(stream);
          }),
        );

        expect(Array.from(collected)).toEqual(events);

        const msgs = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.conversationId, conversationId))
            .orderBy(asc(chatMessages.seq)),
        );
        expect(msgs).toHaveLength(2);
        expect(msgs[0]!.role).toBe("user");
        expect(msgs[0]!.content).toBe("hi");
        expect(msgs[0]!.seq).toBe(1);
        expect(msgs[1]!.role).toBe("assistant");
        expect(msgs[1]!.content).toBe("Hello world");
        expect(msgs[1]!.seq).toBe(2);

        const convRows = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, conversationId)),
        );
        expect(convRows).toHaveLength(1);
        expect(convRows[0]!.status).toBe("completed");
        expect(convRows[0]!.metadata).toMatchObject({
          externalSessionId: "ext-1",
        });
      }).pipe(
        Effect.provide(
          buildLayer(
            mockAdapter({
              events: [
                {
                  type: "session_init",
                  externalSessionId: "ext-1",
                  model: "sonnet",
                },
                { type: "turn_start" },
                { type: "text_delta", text: "Hello" },
                { type: "text_delta", text: " world" },
                { type: "turn_end", stopReason: "end_turn" },
              ],
            }),
          ),
        ),
      ),
  );

  it.effect(
    "records externalSessionId in conversation metadata from session_init event",
    () => {
      const adapter = mockAdapter({
        events: [
          {
            type: "session_init",
            externalSessionId: "ext-session-xyz",
            model: "sonnet",
          },
          { type: "turn_start" },
          { type: "text_delta", text: "ok" },
          { type: "turn_end", stopReason: "end_turn" },
        ],
      });
      return Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* svc.sendTurn({
              conversationId,
              tenantId: TENANT_A,
              userId: USER_ID,
              prompt: "hi",
            });
            return yield* Stream.runCollect(stream);
          }),
        );

        const convRows = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, conversationId)),
        );
        const meta = convRows[0]!.metadata as Record<string, unknown>;
        expect(meta.externalSessionId).toBe("ext-session-xyz");
      }).pipe(Effect.provide(buildLayer(adapter)));
    },
  );

  it.effect(
    "second sendTurn after first completes passes resumeSessionId to the adapter",
    () => {
      const events: AgentEvent[] = [
        { type: "session_init", externalSessionId: "ext-1", model: "sonnet" },
        { type: "turn_start" },
        { type: "text_delta", text: "ok" },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const base = mockAdapter({ events });
      const calls: AdapterTurnInput[] = [];
      const spyAdapter: AgentAdapter = {
        adapterId: base.adapterId,
        sendTurn: (input) => {
          calls.push(input);
          return base.sendTurn(input);
        },
      };

      return Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* svc.sendTurn({
              conversationId,
              tenantId: TENANT_A,
              userId: USER_ID,
              prompt: "first",
            });
            return yield* Stream.runCollect(stream);
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* svc.sendTurn({
              conversationId,
              tenantId: TENANT_A,
              userId: USER_ID,
              prompt: "second",
            });
            return yield* Stream.runCollect(stream);
          }),
        );

        expect(calls).toHaveLength(2);
        expect(calls[0]!.resumeSessionId).toBeUndefined();
        expect(calls[1]!.resumeSessionId).toBe("ext-1");
      }).pipe(Effect.provide(buildLayer(spyAdapter)));
    },
  );

  it.effect(
    "second sendTurn while first is still active fails with TurnInProgressError",
    () => {
      // First turn's stream is consumed in full (fast scripted events)
      // before we start the second. The conversation's status is manually
      // flipped back to "active" in the DB to simulate the "first turn
      // still running" state — simpler + more deterministic than juggling
      // concurrent scopes, and it exercises exactly the status-guard code
      // path we care about here.
      const adapter = mockAdapter({
        events: [
          { type: "turn_start" },
          { type: "turn_end", stopReason: "end_turn" },
        ],
      });

      return Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        // Run + drain the first turn so persistence completes and state
        // lands on disk. Then force the conversation back to "active" to
        // simulate an in-flight turn.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* svc.sendTurn({
              conversationId,
              tenantId: TENANT_A,
              userId: USER_ID,
              prompt: "first",
            });
            return yield* Stream.runCollect(stream);
          }),
        );
        yield* Effect.promise(async () =>
          ctx.db
            .update(chatConversations)
            .set({ status: "active" })
            .where(eq(chatConversations.id, conversationId)),
        );

        const secondExit = yield* Effect.scoped(
          svc.sendTurn({
            conversationId,
            tenantId: TENANT_A,
            userId: USER_ID,
            prompt: "second",
          }),
        ).pipe(Effect.exit);

        expect(Exit.isFailure(secondExit)).toBe(true);
        if (Exit.isFailure(secondExit)) {
          expect(String(secondExit.cause)).toContain("TurnInProgressError");
        }
      }).pipe(Effect.provide(buildLayer(adapter)));
    },
  );

  it.effect("cross-tenant sendTurn fails with AgentSessionNotFoundError", () => {
    const adapter = mockAdapter({ events: [] });
    return Effect.gen(function* () {
      const svc = yield* AgentSession.asEffect();
      const { conversationId } = yield* svc.create({
        tenantId: TENANT_A,
        userId: USER_ID,
        adapterId: "mock",
      });

      const caught = yield* Effect.scoped(
        svc.sendTurn({
          conversationId,
          tenantId: TENANT_B,
          userId: USER_ID,
          prompt: "hi",
        }),
      ).pipe(
        Effect.catchTag("AgentSessionNotFoundError", (err) =>
          Effect.succeed(err),
        ),
      );

      expect(caught).toBeInstanceOf(AgentSessionNotFoundError);
      expect((caught as AgentSessionNotFoundError).conversationId).toBe(
        conversationId,
      );
      expect((caught as AgentSessionNotFoundError).tenantId).toBe(TENANT_B);
    }).pipe(Effect.provide(buildLayer(adapter)));
  });
});

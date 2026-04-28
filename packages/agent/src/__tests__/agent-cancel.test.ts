// Task 12 tests for AgentSession.cancel + close.
//
// Coverage:
//   1. `cancel` interrupts an in-flight turn, sets status=canceled, and writes
//      a `role=tool, metadata.type="canceled"` marker message. Uses
//      `perEventDelayMs: 200` on the mock adapter to keep the emitter alive
//      long enough for the test fiber to fire `cancel` mid-stream. The turn
//      runs in a forked fiber so the test fiber can reach `cancel`.
//   2. `close` is idempotent — calling on an already-completed conversation
//      succeeds and does not alter state.
//   3. Cross-tenant `cancel` → `AgentSessionNotFoundError` (and the
//      conversation's status is unchanged). Mirrors the hardening pattern
//      established for `sendTurn`.
//
// Why `it.live` for test #1: we sleep-then-cancel on the real wall clock and
// the mock adapter emits events with real `Effect.sleep` delays. Under
// `it.effect`'s `TestClock`, the emitter never advances and the cancel fires
// before the turn even starts.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Stream } from "effect";
import { asc, eq } from "drizzle-orm";

import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import {
  chatConversations,
  chatMessages,
} from "@gmacko/db/schema/sessions";
import { tenants } from "@gmacko/db/schema/tenancy";
import { users } from "@gmacko/db/schema/auth";
import type { TenantId, UserId } from "@gmacko/core/validators";

import {
  AgentSession,
  AgentSessionNotFoundError,
  layerAgent,
} from "../agent-session.js";
import { mockAdapter } from "../mock-adapter.js";
import type { AgentAdapter, AgentEvent } from "../adapter.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const TENANT_A = "00000000-0000-0000-0000-0000000000ca" as TenantId;
const TENANT_B = "00000000-0000-0000-0000-0000000000cb" as TenantId;
const USER_ID = "user_cancel_abc" as UserId;

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestDb();
  await ctx.db.insert(tenants).values([
    { id: TENANT_A, name: "Tenant A", slug: "tenant-cancel-a" },
    { id: TENANT_B, name: "Tenant B", slug: "tenant-cancel-b" },
  ]);
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "Cancel User",
    email: "cancel@example.com",
  });
});

afterEach(async () => {
  await ctx.teardown();
});

const buildLayer = (adapter: AgentAdapter) =>
  Layer.provide(layerAgent(adapter), layerGmackoDb(ctx.db));

describe("@gmacko/agent AgentSession.cancel + close", () => {
  it.live(
    "cancel interrupts an in-flight turn, marks canceled, writes marker message",
    () => {
      const events: AgentEvent[] = [
        { type: "turn_start" },
        { type: "text_delta", text: "x" },
        { type: "text_delta", text: "y" },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const adapter = mockAdapter({ events, perEventDelayMs: 200 });

      return Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        // Fork the turn into a separate fiber so the test fiber can fire
        // cancel mid-stream. The forked fiber owns its own Scope via
        // `Effect.scoped`. `Effect.forkChild` inherits the current fiber
        // family for supervision but does not attach to scope (which is
        // what we want here — we join it explicitly via Fiber.await).
        const turnFiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* svc.sendTurn({
                conversationId,
                tenantId: TENANT_A,
                userId: USER_ID,
                prompt: "hi",
              });
              return yield* Stream.runCollect(stream);
            }),
          ).pipe(Effect.exit),
        );

        // Let the turn begin and DB status flip to "active" before we cancel.
        yield* Effect.sleep("100 millis");

        yield* svc.cancel({
          conversationId,
          tenantId: TENANT_A,
        });

        // Wait for the forked turn fiber to finish after interruption.
        yield* Fiber.await(turnFiber);

        const [convo] = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, conversationId)),
        );
        expect(convo?.status).toBe("canceled");

        const msgs = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.conversationId, conversationId))
            .orderBy(asc(chatMessages.seq)),
        );
        // Expect a user row (seq=1) plus a canceled marker row. The
        // assistant row from `turn_end` is NEVER persisted because the
        // stream was interrupted before the end-of-turn finalizer produced
        // the normal success path.
        expect(msgs.some((m) => m.role === "user" && m.content === "hi")).toBe(
          true,
        );
        const marker = msgs.find(
          (m) =>
            m.role === "tool" &&
            (m.metadata as Record<string, unknown>).type === "canceled",
        );
        expect(marker).toBeDefined();
      }).pipe(Effect.provide(buildLayer(adapter)));
    },
  );

  it.effect(
    "close is idempotent on an already-completed conversation",
    () => {
      const events: AgentEvent[] = [
        { type: "turn_start" },
        { type: "text_delta", text: "ok" },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const adapter = mockAdapter({ events });

      return Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        // Drive the turn to completion so the conversation is "completed".
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

        const rowsBefore = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, conversationId)),
        );
        expect(rowsBefore[0]!.status).toBe("completed");

        // First close → no-op (already completed).
        yield* svc.close({
          conversationId,
          tenantId: TENANT_A,
        });
        // Second close → still no-op, no error.
        yield* svc.close({
          conversationId,
          tenantId: TENANT_A,
        });

        const rowsAfter = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, conversationId)),
        );
        expect(rowsAfter[0]!.status).toBe("completed");
      }).pipe(Effect.provide(buildLayer(adapter)));
    },
  );

  it.effect(
    "cross-tenant cancel fails with AgentSessionNotFoundError and leaves status unchanged",
    () => {
      const adapter = mockAdapter({ events: [] });
      return Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const { conversationId } = yield* svc.create({
          tenantId: TENANT_A,
          userId: USER_ID,
          adapterId: "mock",
        });

        const cancelExit = yield* svc
          .cancel({
            conversationId,
            tenantId: TENANT_B,
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(cancelExit)).toBe(true);
        const caught = yield* svc
          .cancel({
            conversationId,
            tenantId: TENANT_B,
          })
          .pipe(
            Effect.catchTag("AgentSessionNotFoundError", (err) =>
              Effect.succeed(err),
            ),
          );

        expect(caught).toBeInstanceOf(AgentSessionNotFoundError);
        expect((caught as AgentSessionNotFoundError).conversationId).toBe(
          conversationId,
        );
        expect((caught as AgentSessionNotFoundError).tenantId).toBe(TENANT_B);

        const rows = yield* Effect.promise(async () =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, conversationId)),
        );
        expect(rows[0]!.status).toBe("pending");
      }).pipe(Effect.provide(buildLayer(adapter)));
    },
  );
});

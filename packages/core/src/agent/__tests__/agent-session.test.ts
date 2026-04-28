// Task 9 tests for AgentSession.create — insertion into chat_conversations,
// uuid return, and metadata serialization (systemPrompt/allowedTools/cwd).
//
// sendTurn, cancel, close land in Tasks 10 and 12; those tests are additive
// and live in follow-on test files or extensions to this one.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";

import { createTestDb } from "@gmacko/core/db/testing";
import { layerGmackoDb } from "@gmacko/core/db";
import { chatConversations } from "@gmacko/core/db/schema/sessions";
import { tenants } from "@gmacko/core/db/schema/tenancy";
import { users } from "@gmacko/core/db/schema/auth";
import type { TenantId, UserId } from "@gmacko/core/validators";

import { AgentSession, layerAgent } from "../agent-session.js";
import { mockAdapter } from "../mock-adapter.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const TENANT_ID = "00000000-0000-0000-0000-000000000001" as TenantId;
const USER_ID = "user_agent_session_abc" as UserId;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let ctx: TestCtx;
let agentLayer: Layer.Layer<AgentSession>;

beforeEach(async () => {
  ctx = await createTestDb();
  await ctx.db.insert(tenants).values({
    id: TENANT_ID,
    name: "Test Tenant",
    slug: "test-tenant",
  });
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "Test User",
    email: "agent-session@example.com",
  });
  agentLayer = Layer.provide(
    layerAgent(mockAdapter({ events: [] })),
    layerGmackoDb(ctx.db),
  );
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/agent AgentSession.create", () => {
  it.effect(
    "inserts a chat_conversations row with status='pending' + adapterId + tenantId + userId",
    () =>
      Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const result = yield* svc.create({
          tenantId: TENANT_ID,
          userId: USER_ID,
          adapterId: "claude-code",
        });

        const rows = yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, result.conversationId)),
        );
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.status).toBe("pending");
        expect(row.adapterId).toBe("claude-code");
        expect(row.tenantId).toBe(TENANT_ID);
        expect(row.userId).toBe(USER_ID);
      }).pipe(Effect.provide(agentLayer)),
  );

  it.effect(
    "returns a conversationId that is a valid UUID and matches the inserted row",
    () =>
      Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const result = yield* svc.create({
          tenantId: TENANT_ID,
          userId: USER_ID,
          adapterId: "claude-code",
        });

        expect(result.conversationId).toMatch(UUID_RE);

        const rows = yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, result.conversationId)),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe(result.conversationId);
      }).pipe(Effect.provide(agentLayer)),
  );

  it.effect(
    "stores systemPrompt / allowedTools / cwd in metadata jsonb",
    () =>
      Effect.gen(function* () {
        const svc = yield* AgentSession.asEffect();
        const result = yield* svc.create({
          tenantId: TENANT_ID,
          userId: USER_ID,
          adapterId: "claude-code",
          systemPrompt: "Be concise.",
          allowedTools: ["Read"],
          cwd: "/tmp",
        });

        const rows = yield* Effect.promise(() =>
          ctx.db
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.id, result.conversationId)),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.metadata).toEqual({
          systemPrompt: "Be concise.",
          allowedTools: ["Read"],
          cwd: "/tmp",
        });
      }).pipe(Effect.provide(agentLayer)),
  );
});

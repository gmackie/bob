import "server-only";
import { and, eq, asc } from "drizzle-orm";
import { Effect, Stream } from "effect";

import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { CurrentUser } from "@gmacko/core/rpc/context";
import { AuthMiddleware } from "@gmacko/core/auth";
import {
  AgentSession,
  AgentSessionNotFoundError,
} from "@gmacko/core/agent";
import { GmackoDb } from "@gmacko/core/db";
import {
  chatConversations,
  chatMessages,
} from "@gmacko/core/db/schema/sessions";

// Real handlers for AgentRpc — replaces the in-memory stubs from
// `@gmacko/contracts/stubs/agent`.
//
// Streaming shape: `agent.sendTurn` is declared `stream: true`. The
// `AgentSession.sendTurn` service method returns
// `Effect<Stream<AgentEvent, AdapterError>, AgentSessionNotFoundError |
// TurnInProgressError | AdapterError, Scope>`. We use `Stream.unwrap` to
// flatten the effect into a Stream so the handler shape matches the
// streaming-handler contract (Stream | Effect<Queue.Dequeue, …>).
//
// `agent.getTranscript` shape: `AgentSession` does NOT yet expose a
// transcript reader. Per the 6K plan we read `chat_conversations` +
// `chat_messages` directly from `GmackoDb`, scoped to the caller's
// tenant. If the conversation row is missing, surface
// `AgentSessionNotFoundError` to match the contract.

export const agentHandlerMap = AgentRpc.middleware(AuthMiddleware).of({
  "agent.createSession": ({
    adapterId,
    title,
    systemPrompt,
    allowedTools,
    cwd,
  }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const session = yield* AgentSession.asEffect();
      const created = yield* session.create({
        tenantId: user.tenantId,
        userId: user.userId,
        adapterId,
        title,
        systemPrompt,
        allowedTools,
        cwd,
      });
      return {
        conversationId: created.conversationId,
        status: created.status,
      };
    }),

  "agent.sendTurn": ({ conversationId, prompt }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const user = yield* CurrentUser.asEffect();
        const session = yield* AgentSession.asEffect();
        const stream = yield* session.sendTurn({
          conversationId,
          tenantId: user.tenantId,
          userId: user.userId,
          prompt,
        });
        return stream;
      }),
    ),

  "agent.cancelSession": ({ conversationId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const session = yield* AgentSession.asEffect();
      yield* session.cancel({
        conversationId,
        tenantId: user.tenantId,
      });
    }),

  "agent.closeSession": ({ conversationId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const session = yield* AgentSession.asEffect();
      yield* session.close({
        conversationId,
        tenantId: user.tenantId,
      });
    }),

  "agent.getTranscript": ({ conversationId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const db = yield* GmackoDb.asEffect();

      const convRows = yield* Effect.promise(async () =>
        db
          .select()
          .from(chatConversations)
          .where(
            and(
              eq(chatConversations.id, conversationId),
              eq(chatConversations.tenantId, user.tenantId),
            ),
          )
          .limit(1),
      );
      const conv = convRows[0];
      if (!conv) {
        return yield* Effect.fail(
          new AgentSessionNotFoundError({
            conversationId,
            tenantId: user.tenantId as string,
          }),
        );
      }

      const msgRows = yield* Effect.promise(async () =>
        db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, conversationId))
          .orderBy(asc(chatMessages.seq)),
      );

      return {
        conversation: {
          id: conv.id,
          tenantId: conv.tenantId,
          userId: conv.userId,
          title: conv.title,
          adapterId: conv.adapterId,
          status: conv.status,
          metadata: conv.metadata,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        },
        messages: msgRows.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          seq: m.seq,
          role: m.role,
          content: m.content,
          metadata: m.metadata,
          createdAt: m.createdAt,
        })),
      };
    }),
});

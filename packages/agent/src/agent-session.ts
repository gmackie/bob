// Effect service for tenant-scoped agent sessions backed by the
// `chat_conversations` + `chat_messages` tables.
//
// Task 9 lands only `create` — it inserts a pending conversation row and
// returns its id. `sendTurn`, `cancel`, and `close` land in Tasks 10 and 12,
// which is why the `AgentAdapter` injected into `layerAgent` is captured in
// the closure but unused for now: later tasks will reach into that reference
// without needing to restructure the Layer.
//
// Error channel stays empty (`never`) for `create`: the insert cannot
// meaningfully conflict (uuid is freshly generated here) and the only other
// failure mode — FK violations on tenantId/userId — is a programmer error
// caller-side. Real tagged errors (AgentSessionNotFoundError,
// TurnInProgressError) land with Task 10 / 12.
//
// NOTE: not exported from the package barrel yet — Task 13 handles the
// public API surface.
import { randomUUID } from "node:crypto";
import { Effect, Layer, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import { chatConversations } from "@gmacko/db/schema/sessions";
import type { TenantId, UserId } from "@gmacko/validators";

import type { AgentAdapter } from "./adapter.js";

export interface CreateSessionInput {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  /** e.g. "claude-code", "mock". Stored verbatim in `chat_conversations.adapter_id`. */
  readonly adapterId: string;
  readonly title?: string;
  readonly systemPrompt?: string;
  readonly allowedTools?: readonly string[];
  readonly cwd?: string;
}

export interface CreatedSession {
  /**
   * Not branded as `ChatConversationId` yet — once downstream services need
   * the brand (Task 10's `sendTurn` / `cancel`), we can promote this.
   */
  readonly conversationId: string;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly adapterId: string;
  readonly status: "pending";
}

export interface AgentSessionShape {
  readonly create: (
    input: CreateSessionInput,
  ) => Effect.Effect<CreatedSession, never>;
  // sendTurn + cancel + close land in Tasks 10, 12.
}

export class AgentSession extends ServiceMap.Service<
  AgentSession,
  AgentSessionShape
>()("@gmacko/agent/AgentSession") {}

/**
 * Build the AgentSession layer with a concrete `AgentAdapter`.
 *
 * The adapter is injected as a plain function argument (not an Effect
 * service) because callers may run different adapters per session — for
 * example the Claude Code CLI adapter in production and `MockAdapter` in
 * tests. The reference is captured in the closure for the Layer; Task 9
 * doesn't use it (hence the `void adapter` below to silence TS/ESLint
 * unused-parameter warnings), but Tasks 10 and 12 will reach into it from
 * `sendTurn` without having to restructure the Layer.
 */
export const layerAgent = (
  adapter: AgentAdapter,
): Layer.Layer<AgentSession, never, GmackoDb> =>
  Layer.effect(AgentSession)(
    Effect.gen(function* () {
      const db = yield* GmackoDb;
      // Intentionally captured-but-unused in Task 9; Task 10's `sendTurn`
      // closes over this reference to dispatch turns to the adapter.
      void adapter;

      const create: AgentSessionShape["create"] = ({
        tenantId,
        userId,
        adapterId,
        title,
        systemPrompt,
        allowedTools,
        cwd,
      }) =>
        Effect.gen(function* () {
          const id = randomUUID();
          const metadata: Record<string, unknown> = {};
          if (systemPrompt !== undefined) {
            metadata.systemPrompt = systemPrompt;
          }
          if (allowedTools !== undefined) {
            metadata.allowedTools = allowedTools;
          }
          if (cwd !== undefined) {
            metadata.cwd = cwd;
          }

          yield* Effect.promise(async () =>
            db.insert(chatConversations).values({
              id,
              tenantId,
              userId,
              title: title ?? null,
              adapterId,
              status: "pending",
              metadata,
            }),
          );

          return {
            conversationId: id,
            tenantId,
            userId,
            adapterId,
            status: "pending" as const,
          };
        });

      return { create } satisfies AgentSessionShape;
    }),
  );

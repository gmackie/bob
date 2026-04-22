// Effect service for tenant-scoped agent sessions backed by the
// `chat_conversations` + `chat_messages` tables.
//
// Task 9 landed `create`. Task 10 (this file) adds `sendTurn` — SELECT the
// conversation (tenant/user-scoped), guard against concurrent turns, persist
// a `user` row, dispatch to the injected adapter, and project the adapter's
// event stream into the transcript. On stream exit (clean or errored) the
// final batch of assistant/tool rows lands + the conversation's status is
// transitioned to `completed` or `failed`.
//
// `cancel` + `close` land in Task 12; the public barrel (`src/index.ts`)
// lands in Task 13.
//
// Effect 4 drift notes already captured in Phase 6E Tasks 6-8 and re-applied
// here:
//   - `Queue.end` (not `Queue.shutdown`) for clean stream completion.
//   - Drizzle thenables need `Effect.promise(async () => db.<q>())` wrapping.
//   - Bare `.returning()` (no field projection) — matches Task 9's `create`.
//   - `Stream.onExit(finalizer)` is the canonical finalizer-with-exit in
//     Effect 4.0.0-beta.43 (Stream.d.ts:11590). Replaces the (absent)
//     `Stream.ensuringWith` name used in earlier Effect 3 APIs.
//   - `Stream.tap` preserves elements while running an Effect per element —
//     used here to accumulate per-turn state in a `Ref`.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Exit, Layer, Ref, Schema, ServiceMap, Stream } from "effect";

import { GmackoDb } from "@gmacko/db";
import {
  chatConversations,
  chatMessages,
} from "@gmacko/db/schema/sessions";
import type { TenantId, UserId } from "@gmacko/validators";

import type {
  AdapterError,
  AgentAdapter,
  AgentEvent,
} from "./adapter.js";

// --- Inputs / outputs ------------------------------------------------------

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

export interface SendTurnInput {
  readonly conversationId: string;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly prompt: string;
}

// --- Tagged errors ---------------------------------------------------------

export class AgentSessionNotFoundError extends Schema.TaggedErrorClass<AgentSessionNotFoundError>()(
  "AgentSessionNotFoundError",
  { conversationId: Schema.String, tenantId: Schema.String },
) {}

export class TurnInProgressError extends Schema.TaggedErrorClass<TurnInProgressError>()(
  "TurnInProgressError",
  { conversationId: Schema.String },
) {}

// --- Service shape ---------------------------------------------------------

export interface AgentSessionShape {
  readonly create: (
    input: CreateSessionInput,
  ) => Effect.Effect<CreatedSession, never>;
  readonly sendTurn: (
    input: SendTurnInput,
  ) => Effect.Effect<
    Stream.Stream<AgentEvent, AdapterError>,
    AgentSessionNotFoundError | TurnInProgressError | AdapterError,
    import("effect/Scope").Scope
  >;
  // cancel + close land in Task 12.
}

export class AgentSession extends ServiceMap.Service<
  AgentSession,
  AgentSessionShape
>()("@gmacko/agent/AgentSession") {}

// --- Layer -----------------------------------------------------------------

/**
 * Build the AgentSession layer with a concrete `AgentAdapter`.
 *
 * The adapter is injected as a plain function argument (not an Effect
 * service) because callers may run different adapters per session — for
 * example the Claude Code CLI adapter in production and `MockAdapter` in
 * tests. The reference is captured in the closure for the Layer; `sendTurn`
 * reaches into it to dispatch each turn.
 */
export const layerAgent = (
  adapter: AgentAdapter,
): Layer.Layer<AgentSession, never, GmackoDb> =>
  Layer.effect(AgentSession)(
    Effect.gen(function* () {
      const db = yield* GmackoDb;

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

      const sendTurn: AgentSessionShape["sendTurn"] = ({
        conversationId,
        tenantId,
        userId,
        prompt,
      }) =>
        Effect.gen(function* () {
          // 1) SELECT the conversation scoped to tenant+user. Cross-tenant
          //    access shows up here as a zero-row result — collapse into
          //    AgentSessionNotFoundError so we don't leak row existence.
          const convRows = yield* Effect.promise(async () =>
            db
              .select()
              .from(chatConversations)
              .where(
                and(
                  eq(chatConversations.id, conversationId),
                  eq(chatConversations.tenantId, tenantId),
                  eq(chatConversations.userId, userId),
                ),
              ),
          );
          const row = convRows[0];
          if (!row) {
            return yield* Effect.fail(
              new AgentSessionNotFoundError({
                conversationId,
                tenantId: tenantId as string,
              }),
            );
          }

          // 2) Reject concurrent turns on an already-active conversation.
          if (row.status === "active") {
            return yield* Effect.fail(
              new TurnInProgressError({ conversationId }),
            );
          }

          // 3) Flip to "active" BEFORE we produce a stream, so a racing
          //    second `sendTurn` in the same fiber family sees it.
          yield* Effect.promise(async () =>
            db
              .update(chatConversations)
              .set({ status: "active", updatedAt: new Date() })
              .where(eq(chatConversations.id, conversationId)),
          );

          // 4) Allocate seq for the user message: SELECT-then-INSERT (we
          //    avoid Effect.tryPromise({try, catch}) per the Phase 6D
          //    drift finding — drizzle errors from try/catch leak through
          //    @effect/vitest). Ordering is deterministic because we're
          //    inside a single sequential Effect fiber.
          const prevUserMax = yield* Effect.promise(async () =>
            db
              .select({ seq: chatMessages.seq })
              .from(chatMessages)
              .where(eq(chatMessages.conversationId, conversationId))
              .orderBy(desc(chatMessages.seq))
              .limit(1),
          );
          const userSeq = (prevUserMax[0]?.seq ?? 0) + 1;

          yield* Effect.promise(async () =>
            db.insert(chatMessages).values({
              conversationId,
              seq: userSeq,
              role: "user",
              content: prompt,
              metadata: {},
            }),
          );

          // 5) Extract adapter turn options from stored metadata.
          const meta = row.metadata as Record<string, unknown>;
          const resumeSessionId =
            typeof meta.externalSessionId === "string"
              ? meta.externalSessionId
              : undefined;
          const systemPrompt =
            typeof meta.systemPrompt === "string"
              ? meta.systemPrompt
              : undefined;
          const allowedTools = Array.isArray(meta.allowedTools)
            ? (meta.allowedTools as readonly string[])
            : undefined;
          const cwd =
            typeof meta.cwd === "string" ? meta.cwd : undefined;

          // 6) Spawn the adapter turn.
          const inner = yield* adapter.sendTurn({
            prompt,
            resumeSessionId,
            systemPrompt,
            allowedTools,
            cwd,
          });

          // 7) Per-turn event buffer held in a Ref so the Stream.tap +
          //    Stream.onExit finalizers both see the same accumulation.
          interface TurnBuffer {
            texts: string[];
            toolEvents: AgentEvent[];
            externalSessionId: string | null;
          }
          const turnBuffer = yield* Ref.make<TurnBuffer>({
            texts: [],
            toolEvents: [],
            externalSessionId: null,
          });

          // End-of-turn persistence: batch-insert assistant/tool rows and
          // update the conversation's status + metadata. Called from
          // `Stream.onExit` so it runs whether the stream completes cleanly
          // or errors. On failure (non-success Exit), status -> "failed";
          // otherwise -> "completed".
          const persist = (
            exit: Exit.Exit<unknown, AdapterError>,
          ): Effect.Effect<void> =>
            Effect.gen(function* () {
              const buf = yield* Ref.get(turnBuffer);

              // Re-read the seq counter — we already wrote the user row,
              // so start from that max + 1.
              const prevMax = yield* Effect.promise(async () =>
                db
                  .select({ seq: chatMessages.seq })
                  .from(chatMessages)
                  .where(eq(chatMessages.conversationId, conversationId))
                  .orderBy(desc(chatMessages.seq))
                  .limit(1),
              );
              let nextSeq = (prevMax[0]?.seq ?? 0) + 1;

              const rows: Array<{
                conversationId: string;
                seq: number;
                role: "assistant" | "tool";
                content: string;
                metadata: Record<string, unknown>;
              }> = [];

              if (buf.texts.length > 0) {
                rows.push({
                  conversationId,
                  seq: nextSeq++,
                  role: "assistant",
                  content: buf.texts.join(""),
                  metadata: {},
                });
              }

              for (const evt of buf.toolEvents) {
                if (evt.type === "tool_use") {
                  rows.push({
                    conversationId,
                    seq: nextSeq++,
                    role: "tool",
                    content: JSON.stringify({
                      name: evt.name,
                      input: evt.input,
                    }),
                    metadata: {
                      toolUseId: evt.id,
                      direction: "call",
                    },
                  });
                } else if (evt.type === "tool_result") {
                  rows.push({
                    conversationId,
                    seq: nextSeq++,
                    role: "tool",
                    content: evt.content,
                    metadata: {
                      toolUseId: evt.toolUseId,
                      direction: "result",
                      isError: evt.isError,
                    },
                  });
                }
              }

              if (rows.length > 0) {
                yield* Effect.promise(async () =>
                  db.insert(chatMessages).values(rows),
                );
              }

              // Merge externalSessionId into the conversation's metadata
              // (preserve any existing fields like systemPrompt, cwd, etc).
              const mergedMeta: Record<string, unknown> = { ...meta };
              if (buf.externalSessionId !== null) {
                mergedMeta.externalSessionId = buf.externalSessionId;
              }

              yield* Effect.promise(async () =>
                db
                  .update(chatConversations)
                  .set({
                    status: Exit.isSuccess(exit) ? "completed" : "failed",
                    metadata: mergedMeta,
                    updatedAt: new Date(),
                  })
                  .where(eq(chatConversations.id, conversationId)),
              );
            });

          // 8) Wrapping stream: observe each event (accumulate into buffer),
          //    pass it through unchanged, and run end-of-turn persistence
          //    when the stream exits.
          const outer = inner.pipe(
            Stream.tap((evt) =>
              Ref.update(turnBuffer, (b) => {
                if (evt.type === "session_init") {
                  return { ...b, externalSessionId: evt.externalSessionId };
                }
                if (evt.type === "text_delta") {
                  return { ...b, texts: [...b.texts, evt.text] };
                }
                if (evt.type === "tool_use" || evt.type === "tool_result") {
                  return { ...b, toolEvents: [...b.toolEvents, evt] };
                }
                return b;
              }),
            ),
            Stream.onExit(persist),
          );

          return outer;
        });

      return { create, sendTurn } satisfies AgentSessionShape;
    }),
  );

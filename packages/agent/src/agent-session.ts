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
// `cancel` + `close` — Task 12 — extend the service with two new methods:
//   - `cancel({conversationId, tenantId})`: interrupts an in-flight turn
//     (if any), transitions status → "canceled", and writes a
//     `role="tool", metadata.type="canceled"` marker message. Interruption
//     of the in-flight turn's stream is driven by a per-conversation
//     `Deferred<void>` held in a closure-scoped `Map`. `sendTurn` wraps its
//     returned stream with `Stream.interruptWhen(Deferred.await(abort))`
//     (Effect 4.0.0-beta.43 Stream.d.ts:11412) — when `cancel` fires the
//     Deferred, the stream ends at the next pull boundary and the scope
//     unwinds cleanly.
//   - `close({conversationId, tenantId})`: idempotent transition to
//     "completed" for sessions in "pending" or "active" state. No-op for
//     already-terminal ("completed", "canceled", "failed") sessions.
// The public barrel (`src/index.ts`) lands in Task 13.
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
//   - `Stream.interruptWhen(deferredAwaitEffect)` halts the stream when the
//     effect completes; success is discarded, failures fail the stream.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Ref,
  ServiceMap,
  Stream,
} from "effect";

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
import {
  AgentSessionNotFoundError,
  TurnInProgressError,
} from "./errors.js";

export {
  AgentSessionNotFoundError,
  TurnInProgressError,
} from "./errors.js";

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

export interface CancelInput {
  readonly conversationId: string;
  readonly tenantId: TenantId;
}

export interface CloseInput {
  readonly conversationId: string;
  readonly tenantId: TenantId;
}

// --- Tagged errors ---------------------------------------------------------
// Tagged error classes live in `./errors.js` (dependency-free subpath); they
// are re-exported at the top of this file.

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
  readonly cancel: (
    input: CancelInput,
  ) => Effect.Effect<void, AgentSessionNotFoundError>;
  readonly close: (
    input: CloseInput,
  ) => Effect.Effect<void, AgentSessionNotFoundError>;
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

      // Active-turn abort registry. Each key is a conversation id with an
      // in-flight turn; the value is a `Deferred<void>` that, when
      // completed, causes the turn's stream to terminate via
      // `Stream.interruptWhen`. Entries are removed on stream exit
      // (success, failure, or cancel-driven interruption).
      const activeTurns = new Map<string, Deferred.Deferred<void>>();

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

          // 6b) Register an abort Deferred in the active-turn registry.
          //     `cancel` fires this Deferred to interrupt the stream via
          //     `Stream.interruptWhen`. The registry entry is cleaned up
          //     in the Stream.onExit finalizer so `cancel` can distinguish
          //     "turn in flight" from "turn already done".
          const abortSignal = yield* Deferred.make<void>();
          activeTurns.set(conversationId, abortSignal);

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
          // otherwise -> "completed". If `cancel` set status to "canceled"
          // first (Task 12), we preserve it here — the Exit will be an
          // interrupt-only Failure due to `Stream.interruptWhen`, which
          // would otherwise be mapped to "failed".
          const persist = (
            exit: Exit.Exit<unknown, AdapterError>,
          ): Effect.Effect<void> =>
            Effect.gen(function* () {
              // Always unregister the abort Deferred first so a late
              // `cancel` is a no-op instead of attempting to signal a
              // stream that's already over.
              activeTurns.delete(conversationId);

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

              // Re-read current status. If `cancel` ran concurrently, the
              // row is already in "canceled"; the Stream.interruptWhen
              // gives us an interrupt-only Failure Exit which naive logic
              // below would map to "failed" and clobber the cancellation.
              const currentStatusRows = yield* Effect.promise(async () =>
                db
                  .select({ status: chatConversations.status })
                  .from(chatConversations)
                  .where(eq(chatConversations.id, conversationId)),
              );
              const currentStatus = currentStatusRows[0]?.status;
              const nextStatus =
                currentStatus === "canceled"
                  ? "canceled"
                  : Exit.isSuccess(exit)
                    ? "completed"
                    : "failed";

              yield* Effect.promise(async () =>
                db
                  .update(chatConversations)
                  .set({
                    status: nextStatus,
                    metadata: mergedMeta,
                    updatedAt: new Date(),
                  })
                  .where(eq(chatConversations.id, conversationId)),
              );
            });

          // 8) Wrapping stream: observe each event (accumulate into buffer),
          //    pass it through unchanged, interrupt on abort signal, and run
          //    end-of-turn persistence when the stream exits.
          //
          //    Stream.interruptWhen(Deferred.await(abort)) terminates the
          //    stream when `cancel` fires the abort Deferred. The stream
          //    ends at the next pull boundary and the Stream.onExit
          //    finalizer runs with an interrupt-only Failure Exit, which
          //    `persist` maps to the `canceled` status by re-reading the
          //    current DB state (cancel has already written it).
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
            Stream.interruptWhen(Deferred.await(abortSignal)),
            Stream.onExit(persist),
          );

          return outer;
        });

      // --- cancel --------------------------------------------------------
      // Verify the conversation exists + belongs to tenant; fail with
      // `AgentSessionNotFoundError` on mismatch. Fire the abort Deferred
      // (if the conversation has a turn in flight) so `sendTurn`'s
      // `Stream.interruptWhen` ends the stream. Then transition the DB
      // status to "canceled" (idempotent — only if currently "pending" or
      // "active") and write a `role="tool", metadata.type="canceled"`
      // marker message. Ordering is "write the canceled marker + flip
      // status BEFORE firing the abort" so the stream's `persist`
      // finalizer sees the canceled status and preserves it.
      const cancel: AgentSessionShape["cancel"] = ({
        conversationId,
        tenantId,
      }) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
              .select()
              .from(chatConversations)
              .where(
                and(
                  eq(chatConversations.id, conversationId),
                  eq(chatConversations.tenantId, tenantId),
                ),
              ),
          );
          const row = rows[0];
          if (!row) {
            return yield* Effect.fail(
              new AgentSessionNotFoundError({
                conversationId,
                tenantId: tenantId as string,
              }),
            );
          }

          // Only transition pending/active → canceled. Terminal states
          // (completed, canceled, failed) stay as-is, but we still fire
          // the abort Deferred below in case a racing `sendTurn` fiber
          // is still mid-stream.
          if (row.status === "pending" || row.status === "active") {
            yield* Effect.promise(async () =>
              db
                .update(chatConversations)
                .set({ status: "canceled", updatedAt: new Date() })
                .where(eq(chatConversations.id, conversationId)),
            );

            // Append canceled marker row using next seq.
            const prev = yield* Effect.promise(async () =>
              db
                .select({ seq: chatMessages.seq })
                .from(chatMessages)
                .where(eq(chatMessages.conversationId, conversationId))
                .orderBy(desc(chatMessages.seq))
                .limit(1),
            );
            const nextSeq = (prev[0]?.seq ?? 0) + 1;
            yield* Effect.promise(async () =>
              db.insert(chatMessages).values({
                conversationId,
                seq: nextSeq,
                role: "tool",
                content: "",
                metadata: { type: "canceled" },
              }),
            );
          }

          // Fire the abort Deferred (if present) so any in-flight
          // sendTurn stream terminates via Stream.interruptWhen. The
          // Deferred is removed from `activeTurns` by the stream's
          // Stream.onExit finalizer; we don't delete it here because
          // doing so would race with the finalizer.
          const abortSignal = activeTurns.get(conversationId);
          if (abortSignal !== undefined) {
            yield* Deferred.succeed(abortSignal, void 0);
          }
        });

      // --- close ---------------------------------------------------------
      // Idempotent transition to "completed" for pending/active sessions.
      // Terminal states (already completed/canceled/failed) are left
      // unchanged. Returns `AgentSessionNotFoundError` if the
      // conversation doesn't exist or belongs to a different tenant.
      const close: AgentSessionShape["close"] = ({
        conversationId,
        tenantId,
      }) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
              .select()
              .from(chatConversations)
              .where(
                and(
                  eq(chatConversations.id, conversationId),
                  eq(chatConversations.tenantId, tenantId),
                ),
              ),
          );
          const row = rows[0];
          if (!row) {
            return yield* Effect.fail(
              new AgentSessionNotFoundError({
                conversationId,
                tenantId: tenantId as string,
              }),
            );
          }

          if (row.status === "pending" || row.status === "active") {
            yield* Effect.promise(async () =>
              db
                .update(chatConversations)
                .set({ status: "completed", updatedAt: new Date() })
                .where(eq(chatConversations.id, conversationId)),
            );
          }
        });

      return { create, sendTurn, cancel, close } satisfies AgentSessionShape;
    }),
  );

import { and, eq, lte, ne, or } from "drizzle-orm";

import type {
  CreateHostTurnInputV1,
  CreateHostTurnResultV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversationEvents, conversations } from "../db/schema/conversations";
import { hostTurnExecutions } from "../db/schema/host";
import { appendConversationEvent } from "./events";
import {
  HostRoutingError,
  routeHostCompletion,
  type HostMessage,
  type HostProviderClient,
  type HostProviderId,
} from "./host-routing";
import { mapEvent } from "./mappers";
import { OodaKernelProblem, idempotencyConflict, notFound } from "./problems";
import { rebuildStoredConversationProjections } from "./projections";
import { isUniqueViolation, stableStringify } from "./serialization";

type OodaDatabase = typeof database;

const HOST_SYSTEM_PROMPT = `You are OODA, the user's personal deliberation partner.
Answer the current turn using the supplied conversation history. Preserve nuance and be candid about uncertainty.
Return exactly one JSON object with two fields:
- "display": the complete answer for the screen, using Markdown when useful.
- "speakable": a concise natural spoken version of at most 90 words, or null when speech would expose credentials or require reading code or tables.
Do not wrap the JSON object in a Markdown code fence.`;

function providerId(value: string): HostProviderId {
  return value === "claude" || value === "openai" ? value : "grok";
}

function persistedProviderId(value: unknown): HostProviderId | null {
  return value === "grok" || value === "claude" || value === "openai"
    ? value
    : null;
}

function payloadText(payload: Record<string, unknown>): string | undefined {
  for (const key of ["display", "content", "text"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function completedResult(
  db: OodaDatabase,
  execution: typeof hostTurnExecutions.$inferSelect,
): Promise<CreateHostTurnResultV1 | null> {
  if (execution.status !== "completed" || !execution.assistantEventId)
    return null;
  const [event] = await db
    .select()
    .from(conversationEvents)
    .where(eq(conversationEvents.id, execution.assistantEventId))
    .limit(1);
  if (
    !event ||
    !execution.provider ||
    !execution.model ||
    !execution.providerResponseId
  )
    return null;
  return {
    assistantEvent: mapEvent(event),
    provider: providerId(execution.provider),
    model: execution.model,
    providerResponseId: execution.providerResponseId,
    replayed: true,
    ...(execution.fallback
      ? { fallback: execution.fallback as CreateHostTurnResultV1["fallback"] }
      : {}),
  };
}

async function findExecution(
  db: OodaDatabase,
  ownerId: string,
  input: CreateHostTurnInputV1,
) {
  const [execution] = await db
    .select()
    .from(hostTurnExecutions)
    .where(
      and(
        eq(hostTurnExecutions.ownerId, ownerId),
        eq(hostTurnExecutions.userEventId, input.userEventId),
      ),
    )
    .limit(1);
  return execution;
}

async function recoverPersistedAssistant(
  db: OodaDatabase,
  ownerId: string,
  input: CreateHostTurnInputV1,
  branchId: string,
  now: Date,
): Promise<CreateHostTurnResultV1 | null> {
  const execution = await findExecution(db, ownerId, input);
  if (!execution) return null;
  if (execution.commandFingerprint !== stableStringify(input)) {
    throw idempotencyConflict();
  }

  const [event] = await db
    .select()
    .from(conversationEvents)
    .where(
      and(
        eq(conversationEvents.conversationId, input.conversationId),
        eq(conversationEvents.branchId, branchId),
        eq(conversationEvents.type, "assistant_turn"),
        eq(conversationEvents.causationId, input.userEventId),
        eq(
          conversationEvents.idempotencyKey,
          `${input.idempotencyKey}:assistant`,
        ),
      ),
    )
    .limit(1);
  if (!event) return null;

  const provider = persistedProviderId(event.payload.provider);
  const model =
    typeof event.payload.model === "string" && event.payload.model
      ? event.payload.model
      : null;
  const providerResponseId =
    typeof event.payload.providerResponseId === "string" &&
    event.payload.providerResponseId
      ? event.payload.providerResponseId
      : null;
  if (!provider || !model || !providerResponseId) return null;

  await db
    .update(hostTurnExecutions)
    .set({
      status: "completed",
      assistantEventId: event.id,
      provider,
      model,
      providerResponseId,
      errorCode: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(hostTurnExecutions.id, execution.id));

  return {
    assistantEvent: mapEvent(event),
    provider,
    model,
    providerResponseId,
    replayed: true,
    ...(execution.fallback
      ? { fallback: execution.fallback as CreateHostTurnResultV1["fallback"] }
      : {}),
  };
}

async function claimExecution(
  db: OodaDatabase,
  ownerId: string,
  input: CreateHostTurnInputV1,
  now: Date,
): Promise<
  | { kind: "completed"; result: CreateHostTurnResultV1 }
  | { kind: "claimed"; execution: typeof hostTurnExecutions.$inferSelect }
> {
  const fingerprint = stableStringify(input);
  let execution = await findExecution(db, ownerId, input);
  if (execution) {
    if (execution.commandFingerprint !== fingerprint)
      throw idempotencyConflict();
    const completed = await completedResult(db, execution);
    if (completed) return { kind: "completed", result: completed };
    if (execution.status === "running" && execution.leaseExpiresAt > now) {
      throw new OodaKernelProblem(
        "HOST_TURN_IN_PROGRESS",
        409,
        "This user turn is already being answered",
      );
    }
    const [claimed] = await db
      .update(hostTurnExecutions)
      .set({
        status: "running",
        errorCode: null,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(hostTurnExecutions.id, execution.id),
          or(
            ne(hostTurnExecutions.status, "running"),
            lte(hostTurnExecutions.leaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    if (!claimed) {
      throw new OodaKernelProblem(
        "HOST_TURN_IN_PROGRESS",
        409,
        "This user turn is already being answered",
      );
    }
    return { kind: "claimed", execution: claimed };
  }

  try {
    const [created] = await db
      .insert(hostTurnExecutions)
      .values({
        ownerId,
        conversationId: input.conversationId,
        userEventId: input.userEventId,
        idempotencyKey: input.idempotencyKey,
        commandFingerprint: fingerprint,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        startedAt: now,
      })
      .returning();
    if (!created) throw new Error("Host turn claim returned no row");
    return { kind: "claimed", execution: created };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    execution = await findExecution(db, ownerId, input);
    if (!execution) throw error;
    const completed = await completedResult(db, execution);
    if (completed) return { kind: "completed", result: completed };
    throw new OodaKernelProblem(
      "HOST_TURN_IN_PROGRESS",
      409,
      "This user turn is already being answered",
    );
  }
}

export async function createHostTurn(
  db: OodaDatabase,
  ownerId: string,
  input: CreateHostTurnInputV1,
  options: {
    providers: HostProviderClient[];
    now?: Date;
    signal?: AbortSignal;
  },
): Promise<CreateHostTurnResultV1> {
  const [source] = await db
    .select({ conversation: conversations, event: conversationEvents })
    .from(conversations)
    .innerJoin(
      conversationEvents,
      and(
        eq(conversationEvents.id, input.userEventId),
        eq(conversationEvents.conversationId, conversations.id),
      ),
    )
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!source || source.event.type !== "user_turn") throw notFound("User turn");

  const now = options.now ?? new Date();
  const recovered = await recoverPersistedAssistant(
    db,
    ownerId,
    input,
    source.event.branchId,
    now,
  );
  if (recovered) return recovered;
  const claim = await claimExecution(db, ownerId, input, now);
  if (claim.kind === "completed") return claim.result;

  const projection = await rebuildStoredConversationProjections(
    db,
    ownerId,
    input.conversationId,
    source.event.branchId,
  );
  const messages: HostMessage[] = projection.timeline.items.flatMap((item) => {
    if (BigInt(item.event.sequence) > source.event.sequence) return [];
    const content = payloadText(item.effectivePayload);
    if (
      !content ||
      (item.event.type !== "user_turn" && item.event.type !== "assistant_turn")
    ) {
      return [];
    }
    return [
      {
        role:
          item.event.type === "user_turn"
            ? ("user" as const)
            : ("assistant" as const),
        content,
      },
    ];
  });

  try {
    const completion = await routeHostCompletion({
      preferredProvider: providerId(source.conversation.hostProvider),
      providers: options.providers,
      messages,
      system: HOST_SYSTEM_PROMPT,
      signal: options.signal,
    });

    if (completion.fallback) {
      await appendConversationEvent(db, ownerId, {
        conversationId: input.conversationId,
        branchId: source.event.branchId,
        type: "system_annotation",
        actor: { type: "system" },
        payload: {
          kind: "provider_fallback",
          selectedProvider: completion.provider,
          ...completion.fallback,
        },
        sensitivity: "general",
        correlationId: source.event.correlationId,
        causationId: input.userEventId,
        idempotencyKey: `${input.idempotencyKey}:fallback`,
        occurredAt: now.toISOString(),
      });
    }

    const assistant = await appendConversationEvent(db, ownerId, {
      conversationId: input.conversationId,
      branchId: source.event.branchId,
      type: "assistant_turn",
      actor: { type: "host", id: completion.provider },
      payload: {
        ...completion.output,
        provider: completion.provider,
        model: completion.model,
        providerResponseId: completion.providerResponseId,
      },
      sensitivity: source.event.sensitivity,
      correlationId: source.event.correlationId,
      causationId: input.userEventId,
      idempotencyKey: `${input.idempotencyKey}:assistant`,
      occurredAt: new Date().toISOString(),
    });

    await db
      .update(hostTurnExecutions)
      .set({
        status: "completed",
        assistantEventId: assistant.event.id,
        provider: completion.provider,
        model: completion.model,
        providerResponseId: completion.providerResponseId,
        fallback: completion.fallback ?? null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(hostTurnExecutions.id, claim.execution.id));

    return {
      assistantEvent: assistant.event,
      provider: completion.provider,
      model: completion.model,
      providerResponseId: completion.providerResponseId,
      replayed: false,
      ...(completion.fallback ? { fallback: completion.fallback } : {}),
    };
  } catch (error) {
    if (error instanceof HostRoutingError) {
      try {
        await appendConversationEvent(db, ownerId, {
          conversationId: input.conversationId,
          branchId: source.event.branchId,
          type: "failure",
          actor: { type: "system" },
          payload: { kind: "host_unavailable", failures: error.failures },
          sensitivity: "general",
          correlationId: source.event.correlationId,
          causationId: input.userEventId,
          idempotencyKey: `${input.idempotencyKey}:failure`,
          occurredAt: new Date().toISOString(),
        });
      } catch (appendError) {
        if (
          !(appendError instanceof OodaKernelProblem) ||
          appendError.code !== "IDEMPOTENCY_CONFLICT"
        )
          throw appendError;
      }
      await db
        .update(hostTurnExecutions)
        .set({
          status: "failed",
          errorCode: "HOST_UNAVAILABLE",
          leaseExpiresAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(hostTurnExecutions.id, claim.execution.id));
    }
    throw error;
  }
}

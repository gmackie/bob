import { z } from "zod";

export const SessionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_started"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({ adapterId: z.string() }),
  }),
  z.object({
    type: z.literal("stdout_chunk"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({ content: z.string() }),
  }),
  z.object({
    type: z.literal("stderr_chunk"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({ content: z.string() }),
  }),
  z.object({
    type: z.literal("session_ended"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({
      exitCode: z.number(),
      durationMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal("session_failed"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({
      error: z.string(),
      exitCode: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal("promotion_available"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({
      noteTitle: z.string(),
      artifactId: z.string(),
      kind: z.string(),
    }),
  }),
  z.object({
    type: z.literal("health_update"),
    sessionId: z.string(),
    threadId: z.string(),
    timestamp: z.string(),
    data: z.object({
      connectorId: z.string(),
      status: z.enum(["up", "degraded", "down"]),
    }),
  }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const RunnerCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_session"),
    sessionId: z.string(),
    threadId: z.string(),
    adapterId: z.string(),
    toolProfileId: z.string(),
    prompt: z.string(),
    workspaceRoot: z.string(),
    systemPrompt: z.string().optional(),
  }),
  z.object({
    type: z.literal("cancel_session"),
    sessionId: z.string(),
  }),
]);

export type RunnerCommand = z.infer<typeof RunnerCommandSchema>;

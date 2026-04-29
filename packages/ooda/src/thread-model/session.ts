import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  adapterId: z.string(),
  toolProfileId: z.string(),
  sourceBundleIds: z.array(z.string()),
  status: SessionStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  exitCode: z.number().optional(),
  createdAt: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;

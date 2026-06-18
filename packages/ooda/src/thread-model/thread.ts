import { z } from "zod";

export const ThreadStatusSchema = z.enum([
  "active",
  "paused",
  "archived",
  "completed",
]);

export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(256),
  slug: z
    .string()
    .regex(slugPattern, "Slug must be lowercase alphanumeric with hyphens"),
  domainPackId: z.string().optional(),
  status: ThreadStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Thread = z.infer<typeof ThreadSchema>;

export const NoteKindSchema = z.enum([
  "observation",
  "hypothesis",
  "action",
  "reflection",
  "source-extract",
]);

export type NoteKind = z.infer<typeof NoteKindSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  sessionId: z.string(),
  kind: NoteKindSchema,
  title: z.string(),
  content: z.string(),
  artifactId: z.string(),
  promotedAt: z.string(),
  createdAt: z.string(),
});

export type Note = z.infer<typeof NoteSchema>;

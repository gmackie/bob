import { z } from "zod";

export const ProblemFieldErrorV1Schema = z
  .object({
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2_000),
  })
  .strict();

export const ProblemV1Schema = z
  .object({
    version: z.literal("v1"),
    type: z.string().url(),
    title: z.string().min(1).max(256),
    status: z.number().int().min(400).max(599),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    detail: z.string().max(20_000).optional(),
    instance: z.string().max(4_096).optional(),
    correlationId: z.string().min(1).max(256),
    errors: z.array(ProblemFieldErrorV1Schema).max(1_000).optional(),
  })
  .strict();

export type ProblemV1 = z.infer<typeof ProblemV1Schema>;

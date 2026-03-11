import { z } from "zod";

export const emailSchema = z.string().email();

export const userSchema = z.object({
  id: z.string(),
  email: emailSchema,
  createdAt: z.coerce.date(),
});

export type UserInput = z.infer<typeof userSchema>;

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

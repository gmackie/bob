import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@linear-clone/api";

export const trpc = createTRPCReact<AppRouter>();

// Alias for convenience
export const api = trpc;

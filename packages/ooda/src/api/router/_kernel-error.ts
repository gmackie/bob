import { TRPCError } from "@trpc/server";

export async function runKernel<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const candidate = error as { status?: number; message?: string };
    const code =
      candidate.status === 404
        ? "NOT_FOUND"
        : candidate.status === 409
          ? "CONFLICT"
          : candidate.status === 400 || candidate.status === 422
            ? "BAD_REQUEST"
            : "INTERNAL_SERVER_ERROR";
    throw new TRPCError({
      code,
      message: candidate.message ?? "OODA kernel operation failed",
      cause: error,
    });
  }
}

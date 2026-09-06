/** Resolve preparation cancellation promptly; late read-only results are ignored. */
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Session cancelled"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    void work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

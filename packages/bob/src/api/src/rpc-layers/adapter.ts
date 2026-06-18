type WrappedRpcHandler = (input: { payload: unknown }) => unknown;

export function adaptRpcHandlers<T extends Record<string, (...args: any[]) => unknown>>(
  handlers: T,
) {
  return Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      (payload: unknown) =>
        (handler as WrappedRpcHandler)({ payload }),
    ]),
  ) as any;
}

import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createBobQueryClient } from "../query.js";

describe("Effect query cache", () => {
  it("scopes keys and filters by procedure and partial payload", async () => {
    const rpc = createBobQueryClient({ baseURL: "http://localhost/api/rpc" });
    const cache = new QueryClient();
    const first = rpc("workItem.get").queryKey({ id: "first" });
    const second = rpc("workItem.get").queryKey({ id: "second" });
    const list = rpc("workItem.list").queryKey({ workspaceId: "ws" });
    cache.setQueryData(first, {});
    cache.setQueryData(second, {});
    cache.setQueryData(list, []);
    await cache.invalidateQueries(
      rpc("workItem.get").queryFilter({ id: "first" }),
    );
    expect(cache.getQueryState(first)?.isInvalidated).toBe(true);
    expect(cache.getQueryState(second)?.isInvalidated).toBe(false);
    await cache.invalidateQueries(rpc("workItem.get").queryFilter());
    expect(cache.getQueryState(second)?.isInvalidated).toBe(true);
    expect(cache.getQueryState(list)?.isInvalidated).toBe(false);
    cache.clear();
  });
});

it("cancels the transport when React Query cancels a read", async () => {
  let started!: () => void;
  let aborted!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const abort = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const rpc = createBobQueryClient({
    baseURL: "http://localhost/api/rpc",
    fetch: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted();
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
        started();
      }),
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const pending = cache.fetchQuery(
    rpc("workItem.get").queryOptions({ id: "work" }),
  );
  const rejected = expect(pending).rejects.toThrow();
  await start;
  await cache.cancelQueries(rpc("workItem.get").queryFilter());
  await abort;
  await rejected;
  cache.clear();
});

import { expect, it } from "vitest";

import { abortable } from "./abortable.js";

it("cancels hung read-only preparation and safely ignores its late rejection", async () => {
  let reject!: (error: Error) => void;
  const preparation = new Promise<void>((_, r) => {
    reject = r;
  });
  const control = new AbortController();
  const waiting = abortable(preparation, control.signal);
  control.abort();
  await expect(waiting).rejects.toThrow();
  reject(Error("late response"));
  await Promise.resolve();
});

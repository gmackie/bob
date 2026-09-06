import { expect, it, vi } from "vitest";

import { stopRecordedProcess } from "./process-identity.js";

it("refuses to declare stopped or signal an ambiguous orphan group", async () => {
  const kill = vi.fn(() => true as const);
  await expect(
    stopRecordedProcess(
      { pid: 123, fingerprint: "original" },
      { fingerprint: () => null, kill },
    ),
  ).rejects.toThrow("Orphan");
  expect(kill).toHaveBeenCalledExactlyOnceWith(-123, 0);
});
it("never kills a reused PID", async () => {
  const kill = vi.fn(() => true as const);
  await expect(
    stopRecordedProcess(
      { pid: 123, fingerprint: "original" },
      { fingerprint: () => "replacement", kill },
    ),
  ).rejects.toThrow("identity changed");
  expect(kill).not.toHaveBeenCalled();
});

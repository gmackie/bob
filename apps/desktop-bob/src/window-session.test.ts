import { expect, it } from "vitest";
import { desktopSessionPartition, preserveSupervisorTitle } from "./window-session.js";

it("retains local auth across launches and isolates connected origins", () => {
  expect(desktopSessionPartition({ kind: "local" })).toBe("persist:bob-local");
  expect(desktopSessionPartition({ kind: "local" })).toBe(desktopSessionPartition({ kind: "local" }));
  const first = desktopSessionPartition({ kind: "connected", appUrl: "https://one.example" });
  expect(first).toMatch(/^persist:/);
  expect(first).not.toBe(desktopSessionPartition({ kind: "connected", appUrl: "https://two.example" }));
});

it("prevents page-title changes from erasing supervisor status across navigation", () => {
  let listener: ((event: { preventDefault(): void }) => void) | undefined;
  let title = "Bob — local mode, execution unavailable";
  preserveSupervisorTitle({ on: (_event, callback) => { listener = callback; } });
  for (const page of ["Sign in", "Settings"]) {
    let prevented = false;
    listener!({ preventDefault: () => { prevented = true; } });
    if (!prevented) title = page;
  }
  expect(title).toContain("execution unavailable");
});

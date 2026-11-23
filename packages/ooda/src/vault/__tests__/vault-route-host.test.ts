import { expect, it } from "vitest";
import { VaultRouteHost } from "../vault-route-host";
import type { VaultService } from "../vault-service";

it("serializes admitted operations through rejection and drains the entire queue", async () => {
  const service = {} as VaultService;
  const host = new VaultRouteHost([{ actor: "alice", kind: "personal", service }]);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const events: string[] = [];
  const first = host.execute("alice", "personal", async () => {
    events.push("first");
    await pending;
    throw new Error("commit failed");
  });
  const failed = expect(first).rejects.toThrow("commit failed");
  const second = host.execute("alice", "personal", async (selected) => {
    expect(selected).toBe(service);
    events.push("second");
    return "saved";
  });
  const drain = host.closeAndDrain().then(() => { events.push("drained"); });
  await expect(host.execute("alice", "personal", async () => { events.push("late"); })).rejects.toMatchObject({ code: "NotReady" });
  expect(events).toEqual(["first"]);
  release();
  await failed;
  expect(await second).toBe("saved");
  await drain;
  expect(events).toEqual(["first", "second", "drained"]);
});

it("does not permit an old instance to reopen after a replacement is created", async () => {
  const binding = { actor: "alice", kind: "personal" as const, service: {} as VaultService };
  const old = new VaultRouteHost([binding]);
  await old.closeAndDrain();
  const next = new VaultRouteHost([binding]);
  await expect(old.execute("alice", "personal", async () => "old")).rejects.toMatchObject({ code: "NotReady" });
  expect(await next.execute("alice", "personal", async () => "new")).toBe("new");
});

it("copies host-owned identity bindings and rejects duplicate or empty identities", async () => {
  const binding = { actor: "alice", kind: "personal" as const, service: {} as VaultService };
  expect(() => new VaultRouteHost([binding, binding])).toThrow("duplicate");
  expect(() => new VaultRouteHost([{ ...binding, actor: " " }])).toThrow("Invalid");
  const host = new VaultRouteHost([binding]);
  binding.actor = "mallory";
  await expect(host.execute("mallory", "personal", async () => "wrong")).rejects.toMatchObject({ code: "NotAuthorized" });
  expect(await host.execute("alice", "personal", async () => "correct")).toBe("correct");
});

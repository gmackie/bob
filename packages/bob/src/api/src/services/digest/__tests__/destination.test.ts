import { readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { db } from "@bob/db/client";
import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { sql } from "@bob/db";
import { makePgliteDb } from "@bob/db/client-pglite";

import type {
  DigestStore,
  DigestTracker,
  ReportingIssue,
} from "../destination.js";
import { DigestRejected, publishDigest } from "../destination.js";
import { makeDigestStore } from "../store.js";

const input = {
  scope: "workspace/tracker/team",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  date: "2026-10-03",
  render: () => Promise.resolve("Bob daily digest — 2026-10-03"),
};

describe("digest delivery with real SQL reservations", () => {
  let handle: PgliteDbHandle;
  let store: DigestStore;
  let tracker: DigestTracker;
  let issues: ReportingIssue[];
  let comments: Map<string, string[]>;
  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
    await handle.db.execute(
      sql`drop table digest_deliveries, digest_destinations`,
    );
    await handle.client.exec(
      readFileSync(
        new URL(
          "../../../../../db/drizzle/0035_digest_destinations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    store = makeDigestStore(handle.db as unknown as typeof db);
  });
  beforeEach(async () => {
    await handle.db.execute(
      sql`truncate digest_deliveries, digest_destinations`,
    );
    issues = [];
    comments = new Map();
    tracker = {
      find: vi.fn<DigestTracker["find"]>(() => Promise.resolve([...issues])),
      get: vi.fn<DigestTracker["get"]>(async (id) => {
        await Promise.resolve();
        const i = issues.find((i) => i.id === id);
        if (!i) throw new Error("unavailable");
        return i;
      }),
      create: vi.fn<DigestTracker["create"]>(async () => {
        await Promise.resolve();
        const i = {
          id: `card-${issues.length}`,
          url: "https://tracker/report",
          description: null,
        };
        issues.push(i);
        return i;
      }),
      retire: vi.fn<DigestTracker["retire"]>(() => Promise.resolve()),
      comments: vi.fn<DigestTracker["comments"]>((id) =>
        Promise.resolve(comments.get(id) ?? []),
      ),
      post: vi.fn<DigestTracker["post"]>(async (id, body) => {
        await Promise.resolve();
        comments.set(id, [...(comments.get(id) ?? []), body]);
      }),
    };
  });
  afterAll(async () => {
    await handle.close();
  });
  it("creates one destination and one comment under concurrent daily calls", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => publishDigest(input, store, tracker)),
    );
    expect(
      results.some((r) => r.status === "fulfilled" && r.value.posted),
    ).toBe(true);
    expect(tracker.create).toHaveBeenCalledTimes(1);
    expect(tracker.post).toHaveBeenCalledTimes(1);
    await publishDigest(input, store, tracker);
    expect(tracker.post).toHaveBeenCalledTimes(1);
  });
  it("adopts and links every historical card before posting; reruns preserve comments", async () => {
    issues = Array.from({ length: 37 }, (_, n) => ({
      id: `old-${n}`,
      url: `https://tracker/${n}`,
      description: "Original",
    }));
    comments.set("old-36", ["Bob daily digest — 2026-10-02"]);
    await publishDigest(input, store, tracker);
    expect(tracker.create).not.toHaveBeenCalled();
    expect(tracker.retire).toHaveBeenCalledTimes(37);
    expect(tracker.retire).toHaveBeenCalledWith(issues[36], issues[0], issues);
    expect(comments.get("old-36")).toEqual(["Bob daily digest — 2026-10-02"]);
    await publishDigest(input, store, tracker);
    expect(tracker.post).toHaveBeenCalledTimes(1);
  });
  it("deduplicates dates found on any historical card, even behind a newer date", async () => {
    issues = [{ id: "old", url: "https://tracker/old", description: null }];
    comments.set("old", [
      "Bob daily digest — 2026-10-04",
      "Bob daily digest — 2026-10-03",
    ]);
    expect((await publishDigest(input, store, tracker)).posted).toBe(false);
    expect(tracker.post).not.toHaveBeenCalled();
  });
  it("lookup failure never creates a card", async () => {
    vi.mocked(tracker.find).mockRejectedValue(new Error("unauthorized"));
    await expect(publishDigest(input, store, tracker)).rejects.toThrow(
      "unauthorized",
    );
    expect(tracker.create).not.toHaveBeenCalled();
  });
  it("recovers a lost create response by lookup", async () => {
    vi.mocked(tracker.create).mockImplementationOnce(async () => {
      await Promise.resolve();
      issues.push({
        id: "committed",
        url: "https://tracker/committed",
        description: null,
      });
      throw new Error("timeout");
    });
    await expect(publishDigest(input, store, tracker)).rejects.toThrow(
      "timeout",
    );
    expect((await publishDigest(input, store, tracker)).posted).toBe(true);
    expect(tracker.create).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost comment response without posting twice", async () => {
    vi.mocked(tracker.post).mockImplementationOnce(async (id, body) => {
      await Promise.resolve();
      comments.set(id, [body]);
      throw new Error("timeout");
    });
    await expect(publishDigest(input, store, tracker)).rejects.toThrow(
      "timeout",
    );
    expect((await publishDigest(input, store, tracker)).posted).toBe(false);
    expect(tracker.post).toHaveBeenCalledTimes(1);
  });
  it("retries definitive failures but surfaces ambiguous delivery for reconciliation", async () => {
    vi.mocked(tracker.post).mockRejectedValueOnce(new DigestRejected("401"));
    await expect(publishDigest(input, store, tracker)).rejects.toThrow("401");
    expect((await publishDigest(input, store, tracker)).posted).toBe(true);
    const tomorrow = { ...input, date: "2026-10-04" };
    vi.mocked(tracker.post).mockRejectedValueOnce(new Error("connection lost"));
    await expect(publishDigest(tomorrow, store, tracker)).rejects.toThrow(
      "connection lost",
    );
    await expect(publishDigest(tomorrow, store, tracker)).rejects.toThrow(
      "pending or already sent",
    );
    expect(tracker.post).toHaveBeenCalledTimes(3);
  });
  it("keeps workspace/tracker/team reservations independent", async () => {
    await store.destination("one", input.workspaceId);
    await store.destination("two", input.workspaceId);
    expect(await store.claimDestination("one")).toBe(true);
    expect(await store.claimDestination("two")).toBe(true);
    expect(await store.claimDate("one", input.date)).toBe(true);
    expect(await store.claimDate("two", input.date)).toBe(true);
    expect(await store.claimDate("one", input.date)).toBe(false);
  });
});

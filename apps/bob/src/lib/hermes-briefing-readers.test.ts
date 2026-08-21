import { describe, expect, it } from "vitest";

import {
  createBobWorkBriefReader,
  createBobWorkStatusReader,
  createBobEveningCloseReader,
  createHermesEveningCloseReader,
  createOodaBriefReader,
  createSkillfleetBriefReader,
  createForgeGraphBriefReader,
} from "./hermes-briefing-readers";

describe("Bob Hermes briefing reader", () => {
  it("returns categorized active work with exact totals and canonical references", async () => {
    const reader = createBobWorkBriefReader({
      now: () => new Date("2026-08-21T14:00:00Z"),
      countActive: async () => ({ backlog: 1, blocked: 1, completed: 40 }),
      listActive: async () => [
        {
          id: "work-1",
          identifier: "BOB-17",
          title: "Deploy the Hermes operator route",
          status: "blocked",
          updatedAt: "2026-08-21T13:59:00Z",
        },
        {
          id: "work-2",
          identifier: "BOB-18",
          title: "Wire the daily brief readers",
          status: "backlog",
          updatedAt: "2026-08-21T13:50:00Z",
        },
      ],
    });

    await expect(reader.read()).resolves.toEqual({
      source: "bob",
      observedAt: "2026-08-21T14:00:00.000Z",
      coverage: "complete",
      total: 2,
      items: [
        {
          label: "BLOCKED · BOB-17 · Deploy the Hermes operator route",
          canonicalRef: { kind: "work-item", id: "work-1" },
        },
        {
          label: "BACKLOG · BOB-18 · Wire the daily brief readers",
          canonicalRef: { kind: "work-item", id: "work-2" },
        },
      ],
    });
  });

  it("reports unknown coverage without inventing work when Bob cannot read", async () => {
    const reader = createBobWorkBriefReader({
      now: () => new Date("2026-08-21T14:00:00Z"),
      countActive: async () => ({ in_progress: 4 }),
      listActive: async () => {
        throw new Error("private database detail");
      },
    });

    await expect(reader.read()).resolves.toEqual({
      source: "bob",
      observedAt: null,
      coverage: "unknown",
      total: 0,
      items: [],
    });
  });

  it("bounds displayed work without losing the exact active total", async () => {
    const active = Array.from({ length: 8 }, (_, index) => ({
      id: `work-${index + 1}`,
      identifier: `BOB-${index + 1}`,
      title: `Work item ${index + 1}`,
      status: "in_progress",
    }));
    const reader = createBobWorkBriefReader({
      now: () => new Date("2026-08-21T14:00:00Z"),
      countActive: async () => ({ in_progress: 8 }),
      listActive: async () => active,
    });

    const snapshot = await reader.read();

    expect(snapshot.total).toBe(8);
    expect(snapshot.items).toHaveLength(5);
    expect(snapshot.items.at(-1)?.canonicalRef.id).toBe("work-5");
  });
});

describe("Bob Hermes status reader", () => {
  it("resolves a canonical work-item identifier embedded in a natural-language query", async () => {
    const reader = createBobWorkStatusReader({
      now: () => new Date("2026-08-21T14:00:00Z"),
      getById: async (id) => id === "BOB-17"
        ? {
            workItem: {
              id: "work-1",
              identifier: "BOB-17",
              title: "Deploy the Hermes operator route",
              status: "in_progress",
            },
          }
        : null,
    });

    await expect(reader.read("Where is BOB-17 right now?")).resolves.toEqual({
      summary: "BOB-17 is IN PROGRESS: Deploy the Hermes operator route",
      canonicalRef: { kind: "work-item", id: "work-1" },
      observedAt: "2026-08-21T14:00:00.000Z",
      coverage: "complete",
    });
  });

  it("labels terminal Bob state as partial when release/runtime evidence is not read", async () => {
    const reader = createBobWorkStatusReader({
      now: () => new Date("2026-08-21T14:00:00Z"),
      getById: async () => ({ workItem: {
        id: "work-2", identifier: "BOB-18", title: "Release Hermes", status: "completed",
      } }),
    });

    const result = await reader.read("status BOB-18");

    expect(result.coverage).toBe("partial");
    expect(result.summary).toMatch(/release.*runtime.*not checked/i);
  });

  it("reports unknown coverage when a query has no canonical identifier", async () => {
    const reader = createBobWorkStatusReader({
      now: () => new Date("2026-08-21T14:00:00Z"),
      getById: async () => {
        throw new Error("must not query without an identifier");
      },
    });

    await expect(reader.read("Where is the release?")).resolves.toEqual({
      summary: "Provide a Bob work-item identifier such as BOB-17 for canonical status.",
      canonicalRef: { kind: "status-query", id: "unresolved" },
      observedAt: "2026-08-21T14:00:00.000Z",
      coverage: "unknown",
    });
  });
});

describe("OODA Hermes briefing reader", () => {
  it("reports pending proposals and Hermes captures without exposing capture text", async () => {
    const fetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/events")) {
        return Response.json({
          items: [
            {
              id: "event-1",
              occurredAt: "2026-08-21T13:45:00Z",
              payload: { source: "hermes", text: "private capture text" },
            },
            {
              id: "event-other",
              occurredAt: "2026-08-21T13:40:00Z",
              payload: { source: "mobile", text: "another private turn" },
            },
          ],
          pageInfo: { hasMore: false },
        });
      }
      return Response.json({
        items: [
          {
            id: "proposal-1",
            kind: "bob_task",
            destination: "bob",
            status: "awaiting_approval",
            updatedAt: "2026-08-21T13:50:00Z",
          },
        ],
        pageInfo: { hasMore: false },
      });
    };
    const reader = createOodaBriefReader({
      origin: "https://ooda.example.com",
      apiKey: "owner-key",
      conversationId: "conversation-1",
      branchId: "branch-1",
      now: () => new Date("2026-08-21T14:00:00Z"),
      fetch: fetch as typeof globalThis.fetch,
    });

    const snapshot = await reader.read();

    expect(snapshot).toEqual({
      source: "ooda",
      observedAt: "2026-08-21T14:00:00.000Z",
      coverage: "complete",
      total: 2,
      items: [
        {
          label: "AWAITING APPROVAL · BOB TASK · bob",
          canonicalRef: { kind: "proposal", id: "proposal-1" },
        },
        {
          label: "CAPTURED · 2026-08-21T13:45:00Z",
          canonicalRef: { kind: "conversation-event", id: "event-1" },
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private capture text");
    await expect(reader.readClose()).resolves.toEqual({
      captured: [{
        label: "CAPTURED · 2026-08-21T13:45:00Z",
        canonicalRef: { kind: "conversation-event", id: "event-1" },
      }],
      tomorrow: [{
        label: "PROPOSED · BOB TASK · bob",
        canonicalRef: { kind: "proposal", id: "proposal-1" },
      }],
      gaps: [],
    });
  });
});

describe("Skillfleet Hermes briefing reader", () => {
  it("summarizes fleet attention and categorized usage from the operator endpoint", async () => {
    const reader = createSkillfleetBriefReader({
      origin: "https://llm.gmac.io",
      readSecret: "operator-secret",
      accessClientId: "access-client-id",
      accessClientSecret: "access-client-secret",
      fetch: (async (_input, init) => {
        expect(init?.headers).toEqual({
          authorization: "Bearer operator-secret",
          "cf-access-client-id": "access-client-id",
          "cf-access-client-secret": "access-client-secret",
        });
        return Response.json({
          schemaVersion: 1,
          observedAt: "2026-08-21T14:00:00.000Z",
          coverage: "complete",
          fleet: {
            total: 2,
            online: 1,
            attention: [{ machineId: "gmacko-mini", status: "stale" }],
          },
          usage: {
            requests: 7,
            successful: 5,
            failed: 1,
            prevented: 1,
            replayed: 0,
            evidenceGaps: 2,
          },
        });
      }) as typeof globalThis.fetch,
    });

    await expect(reader.read()).resolves.toEqual({
      source: "skillfleet",
      observedAt: "2026-08-21T14:00:00.000Z",
      coverage: "complete",
      total: 9,
      items: [
        {
          label: "FLEET · 1/2 online",
          canonicalRef: { kind: "fleet", id: "current" },
        },
        {
          label: "ATTENTION · gmacko-mini · STALE",
          canonicalRef: { kind: "machine", id: "gmacko-mini" },
        },
        {
          label: "HERMES · 7 requests · 1 failed · 2 evidence gaps",
          canonicalRef: { kind: "hermes-usage", id: "current" },
        },
      ],
    });
  });
});

describe("ForgeGraph Hermes briefing reader", () => {
  it("reports bounded changeset evidence across the configured app set", async () => {
    const reader = createForgeGraphBriefReader({
      origin: "https://forgegraf.com",
      apiKey: "forge-key",
      appSlugs: ["bob", "ooda"],
      now: () => new Date("2026-08-21T14:00:00Z"),
      fetch: (async (input) => {
        const url = String(input);
        if (url.includes("app=bob")) {
          return Response.json({ changesets: [
            { id: "change-1", title: "Hermes operator", status: "running" },
          ] });
        }
        return Response.json({ changesets: [
          { id: "change-2", title: "Morning context", status: "passed" },
        ] });
      }) as typeof globalThis.fetch,
    });

    await expect(reader.read()).resolves.toEqual({
      source: "forgegraph",
      observedAt: "2026-08-21T14:00:00.000Z",
      coverage: "complete",
      total: 2,
      items: [
        {
          label: "BOB · RUNNING · Hermes operator",
          canonicalRef: { kind: "changeset", id: "change-1" },
        },
        {
          label: "OODA · PASSED · Morning context",
          canonicalRef: { kind: "changeset", id: "change-2" },
        },
      ],
    });
  });
});

describe("Hermes evening close readers", () => {
  it("categorizes only today's Bob work-item changes as canonical evidence", async () => {
    const reader = createBobEveningCloseReader({
      now: () => new Date("2026-08-21T22:00:00Z"),
      listChanged: async () => [
        { id: "done-1", identifier: "BOB-20", title: "Wire readers", status: "completed", updatedAt: "2026-08-21T18:00:00Z" },
        { id: "blocked-1", identifier: "BOB-21", title: "Deploy secret", status: "blocked", updatedAt: "2026-08-21T19:00:00Z" },
        { id: "waiting-1", identifier: "BOB-22", title: "Review route", status: "in_review", updatedAt: "2026-08-21T20:00:00Z" },
        { id: "old-1", identifier: "BOB-19", title: "Old completion", status: "completed", updatedAt: "2026-08-20T18:00:00Z" },
      ],
    });

    await expect(reader.read()).resolves.toEqual({
      completed: [{ label: "COMPLETED · BOB-20 · Wire readers", canonicalRef: { kind: "work-item", id: "done-1" } }],
      blocked: [{ label: "BLOCKED · BOB-21 · Deploy secret", canonicalRef: { kind: "work-item", id: "blocked-1" } }],
      waiting: [{ label: "IN REVIEW · BOB-22 · Review route", canonicalRef: { kind: "work-item", id: "waiting-1" } }],
      gaps: [],
    });
  });

  it("names Bob truncation instead of reporting a complete close", async () => {
    const reader = createBobEveningCloseReader({
      now: () => new Date("2026-08-21T22:00:00Z"),
      listChanged: async () => Array.from({ length: 101 }, (_, index) => ({
        id: `work-${index}`, title: `Work ${index}`, status: "completed",
        updatedAt: "2026-08-21T18:00:00Z",
      })),
    });

    expect((await reader.read()).gaps).toContain("bob work-item results were truncated");
  });

  it("assembles a partial close while naming sources not yet included", async () => {
    const reader = createHermesEveningCloseReader({
      now: () => new Date("2026-08-21T22:00:00Z"),
      bob: { read: async () => ({ completed: [], blocked: [], waiting: [], gaps: [] }) },
      ooda: { readClose: async () => ({
        captured: [{ label: "CAPTURED · 2026-08-21T13:45:00Z", canonicalRef: { kind: "conversation-event", id: "event-1" } }],
        tomorrow: [{ label: "PROPOSED · BOB TASK · bob", canonicalRef: { kind: "proposal", id: "proposal-1" } }],
        gaps: ["ooda reported partial coverage"],
      }) },
    });

    await expect(reader.read()).resolves.toMatchObject({
      kind: "evening",
      gaps: [
        "ooda reported partial coverage",
        "skillfleet did not report",
        "forgegraph did not report",
      ],
      sections: {
        captured: [{ canonicalRef: { kind: "conversation-event", id: "event-1" }, proposed: false }],
        tomorrow: [{ canonicalRef: { kind: "proposal", id: "proposal-1" }, proposed: true }],
      },
    });
  });
});

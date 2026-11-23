import { describe, expect, it, vi } from "vitest";

import type { BizPulseTodayBriefing } from "../bizpulseIntake";
import {
  bizpulseExternalId,
  fetchBizPulseTodayBriefing,
  mapBriefingToIntakeTasks,
} from "../bizpulseIntake";

const briefing: BizPulseTodayBriefing = {
  briefing: { id: "brief-1", date: "2026-10-01", status: "ready" },
  startupNames: { "st-1": "Acme" },
  tasks: [
    {
      id: "t-1",
      startupId: "st-1",
      title: "  Retry failed   payments ",
      description: "Three invoices bounced overnight.",
      assignee: "agent",
      priority: "high",
      category: "billing",
      sourceRule: "retry_failed_payments",
      status: "pending",
      linkedUrl: "https://bizpulse.cc/acme/billing",
      sortOrder: 2,
    },
    {
      id: "t-2",
      startupId: null,
      title: "Triage error spike",
      description: null,
      assignee: "agent",
      priority: "critical",
      category: "ops",
      sourceRule: "error_spike",
      status: "pending",
      linkedUrl: null,
      sortOrder: 1,
    },
    {
      id: "t-3",
      startupId: "st-1",
      title: "Call the lead investor",
      description: null,
      assignee: "founder",
      priority: "high",
      category: "fundraise",
      sourceRule: null,
      status: "pending",
      linkedUrl: null,
      sortOrder: 0,
    },
    {
      id: "t-4",
      startupId: "st-1",
      title: "Already handled",
      description: null,
      assignee: "agent",
      priority: "low",
      category: null,
      sourceRule: null,
      status: "completed",
      linkedUrl: null,
      sortOrder: 3,
    },
  ],
};

describe("mapBriefingToIntakeTasks", () => {
  it("keeps only open agent tasks, in briefing order, with a stable id per day", () => {
    const tasks = mapBriefingToIntakeTasks(briefing, "2026-10-01");
    expect(tasks.map((t) => t.title)).toEqual([
      "Triage error spike",
      "Retry failed payments",
    ]);
    expect(tasks[1]?.externalId).toBe(
      "bizpulse:2026-10-01:st-1:retry_failed_payments:retry-failed-payments",
    );
    expect(tasks[0]?.externalId).toBe(
      "bizpulse:2026-10-01:portfolio:error_spike:triage-error-spike",
    );
  });

  it("uses the startup as the project and maps priority to the dispatch lane", () => {
    const tasks = mapBriefingToIntakeTasks(briefing, "2026-10-01");
    expect(tasks[1]).toMatchObject({
      projectName: "Acme",
      queueSortOrder: 20,
      externalUrl: "https://bizpulse.cc/acme/billing",
      description: "Three invoices bounced overnight.",
    });
    expect(tasks[0]).toMatchObject({
      projectName: "BizPulse portfolio",
      queueSortOrder: 10,
    });
    expect(tasks[1]?.sourceMetadata).toMatchObject({
      source: "bizpulse",
      briefingId: "brief-1",
      bizpulseTaskId: "t-1",
      sourceRule: "retry_failed_payments",
    });
  });

  it("yields nothing when BizPulse has no briefing yet", () => {
    expect(
      mapBriefingToIntakeTasks(
        { briefing: null, tasks: [], startupNames: {} },
        "2026-10-01",
      ),
    ).toEqual([]);
  });

  it("keeps the id stable across whitespace and case changes in the title", () => {
    const a = bizpulseExternalId("2026-10-01", {
      startupId: "s",
      sourceRule: "r",
      title: "Retry Failed Payments",
    });
    const b = bizpulseExternalId("2026-10-01", {
      startupId: "s",
      sourceRule: "r",
      title: " retry  failed payments ",
    });
    expect(a).toBe(b);
  });
});

describe("fetchBizPulseTodayBriefing", () => {
  it("calls the tRPC query with the API key and unwraps superjson", async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe("https://bizpulse.test/api/trpc/tasks.todayBriefing");
      expect((init.headers as Record<string, string>).authorization).toBe(
        "Bearer biz_key",
      );
      return Promise.resolve(
        new Response(JSON.stringify({ result: { data: { json: briefing } } }), {
          status: 200,
        }),
      );
    });
    const result = await fetchBizPulseTodayBriefing({
      apiUrl: "https://bizpulse.test/",
      apiKey: "biz_key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.briefing?.id).toBe("brief-1");
    expect(result.tasks).toHaveLength(4);
  });

  it("treats a null result as no briefing and surfaces HTTP failures", async () => {
    const nullFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: { data: { json: null } } })),
      );
    const empty = await fetchBizPulseTodayBriefing({
      apiUrl: "https://x",
      apiKey: "k",
      fetch: nullFetch,
    });
    expect(empty).toEqual({ briefing: null, tasks: [], startupNames: {} });

    const badFetch: typeof fetch = () =>
      Promise.resolve(new Response("nope", { status: 401 }));
    await expect(
      fetchBizPulseTodayBriefing({
        apiUrl: "https://x",
        apiKey: "k",
        fetch: badFetch,
      }),
    ).rejects.toThrow(/HTTP 401/);
  });
});

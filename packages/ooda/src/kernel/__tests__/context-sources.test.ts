import { describe, expect, it, vi } from "vitest";

import {
  applyHostContextPolicy,
  collectContextCandidates,
  createConfiguredContextSources,
  formatDisclosedContext,
  resolveContextSourceConfig,
  type ContextCandidate,
  type ConversationContextSource,
} from "../context-sources";

const candidate = (
  overrides: Partial<ContextCandidate> = {},
): ContextCandidate => ({
  sourceType: "bob_work_item",
  sourceId: "work-1",
  sensitivity: "general",
  content: "BOB-12 - in progress - Unify OODA chat",
  ...overrides,
});

describe("conversation context sources", () => {
  it("reuses runner-only BizPulse credentials for read-only conversation context", () => {
    expect(
      resolveContextSourceConfig({
        OODA_BIZPULSE_API_URL: "https://bizpulse.example",
        OODA_BIZPULSE_API_KEY: "biz_private_key",
      }),
    ).toMatchObject({
      bizpulse: {
        apiUrl: "https://bizpulse.example",
        apiKey: "biz_private_key",
      },
    });
  });

  it("collects validated candidates without letting one unavailable source block the turn", async () => {
    const healthy: ConversationContextSource = {
      id: "bob",
      inspect: vi.fn(() => Promise.resolve([candidate()])),
    };
    const unavailable: ConversationContextSource = {
      id: "bizpulse",
      inspect: vi.fn(() => Promise.reject(new Error("connection refused"))),
    };
    const ignoresCancellation: ConversationContextSource = {
      id: "forgegraph",
      inspect: vi.fn(() => new Promise<ContextCandidate[]>(() => undefined)),
    };

    const result = await collectContextCandidates(
      [healthy, unavailable, ignoresCancellation],
      {
        query: "OODA chat",
        limitPerSource: 5,
        timeoutMs: 5,
      },
    );

    expect(result.candidates).toEqual([candidate()]);
    expect(result.receipts).toEqual([
      { source: "bob", status: "available", itemCount: 1 },
      {
        source: "bizpulse",
        status: "unavailable",
        itemCount: 0,
        reason: "Source unavailable",
      },
      {
        source: "forgegraph",
        status: "unavailable",
        itemCount: 0,
        reason: "Source unavailable",
      },
    ]);
  });

  it("denies sensitive and restricted candidates before prompt formatting", () => {
    const decisions = applyHostContextPolicy([
      candidate(),
      candidate({
        sourceType: "bizpulse_venture",
        sourceId: "venture-1",
        sensitivity: "sensitive",
        content: "Confidential runway detail",
      }),
      candidate({
        sourceType: "forgegraph_changeset",
        sourceId: "change-1",
        sensitivity: "restricted",
        content: "Credential-bearing patch",
      }),
      candidate({
        sourceId: "work-credential",
        content: "Investigate Bearer bob_live_super_secret_value in staging",
      }),
    ]);

    expect(decisions.map(({ decision }) => decision)).toEqual([
      "disclosed",
      "denied",
      "denied",
      "redacted",
    ]);
    expect(decisions[1]).not.toHaveProperty("content");
    expect(decisions[2]).not.toHaveProperty("content");
    expect(formatDisclosedContext(decisions)).toContain("BOB-12");
    expect(formatDisclosedContext(decisions)).not.toContain("runway");
    expect(formatDisclosedContext(decisions)).not.toContain("Credential");
    expect(formatDisclosedContext(decisions)).toContain(
      "[REDACTED CREDENTIAL]",
    );
    expect(formatDisclosedContext(decisions)).not.toContain(
      "bob_live_super_secret_value",
    );
  });

  it("normalizes configured Bob, KanBanger, BizPulse, and ForgeGraph reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = String(request);
      if (url.endsWith("/api/v1/work-items/list")) {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer bob-key",
        });
        return Response.json([
          {
            id: "bob-1",
            identifier: "BOB-1",
            title: "Local planning",
            status: "in_progress",
            kind: "task",
            project: { id: "p1", key: "BOB", name: "Bob" },
          },
          {
            id: "kb-1",
            externalId: "OOD-7",
            externalProvider: "linear",
            title: "Voice context",
            status: "todo",
            kind: "issue",
            project: { id: "p2", key: "OOD", name: "OODA" },
          },
        ]);
      }
      if (url.includes("/api/trpc/startup.list")) {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer biz-key",
        });
        return Response.json({
          result: {
            data: {
              json: [
                {
                  id: "venture-1",
                  name: "OODA",
                  slug: "ooda",
                  lifecycleStage: "validation",
                  portfolioRole: "incubating",
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/trpc/focusQueue.list")) {
        return Response.json({
          result: {
            data: {
              json: [
                {
                  id: "focus-1",
                  startupName: "OODA",
                  priority: "high",
                  question: "Can voice become the daily driver?",
                  recommendation: "Run a two-week dogfood test.",
                },
              ],
            },
          },
        });
      }
      if (url.includes("/api/fg/changesets?app=ooda")) {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer forge-key",
        });
        return Response.json({
          changesets: [
            {
              id: "change-1",
              title: "Add context packs",
              status: "open",
              createdAt: "2026-08-07T12:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/api/fg/changesets/change-1")) {
        return Response.json({
          id: "change-1",
          title: "Add context packs",
          status: "open",
          sourceBranch: "feat/context-packs",
          headSha: "0123456789abcdef0123456789abcdef01234567",
          createdAt: "2026-08-07T12:00:00.000Z",
          builds: [{ pipelineName: "verify", status: "passed" }],
          testRuns: [
            {
              suiteName: "unit",
              status: "passed",
              totalTests: 623,
              passedTests: 623,
              failedTests: 0,
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const sources = createConfiguredContextSources(
      {
        bob: {
          apiUrl: "https://bob.example",
          apiKey: "bob-key",
          workspaceId: "00000000-0000-4000-8000-000000000001",
        },
        bizpulse: {
          apiUrl: "https://pulse.example",
          apiKey: "biz-key",
        },
        forgegraph: {
          apiUrl: "https://forge.example",
          apiKey: "forge-key",
          appSlugs: ["ooda"],
        },
      },
      fetchMock,
    );
    const result = await collectContextCandidates(sources, {
      query: "OODA voice planning",
      limitPerSource: 10,
    });

    expect(result.receipts).toHaveLength(3);
    expect(result.candidates.map(({ sourceType }) => sourceType)).toEqual([
      "bob_work_item",
      "kanbanger_issue",
      "bizpulse_venture",
      "bizpulse_venture",
      "forgegraph_changeset",
    ]);
    expect(result.candidates.map(({ content }) => content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("BOB-1"),
        expect.stringContaining("OOD-7"),
        expect.stringContaining("validation"),
        expect.stringContaining("dogfood"),
        expect.stringContaining("Add context packs"),
        expect.stringContaining("branch feat/context-packs"),
        expect.stringContaining("build verify passed"),
        expect.stringContaining("tests unit passed 623/623"),
      ]),
    );
  });
});

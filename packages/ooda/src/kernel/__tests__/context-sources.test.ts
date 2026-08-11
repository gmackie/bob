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

  it("configures authenticated research-vault context only when URL and token are both present", () => {
    expect(
      resolveContextSourceConfig({
        RESEARCH_API_URL: "https://research.example/",
        RESEARCH_SERVICE_TOKEN: "research-secret",
      }),
    ).toMatchObject({
      researchVault: {
        apiUrl: "https://research.example/",
        serviceToken: "research-secret",
      },
    });
    expect(
      resolveContextSourceConfig({
        RESEARCH_API_URL: "https://research.example",
      }),
    ).not.toHaveProperty("researchVault");
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

  it("balances candidate order so the global context cap retains every source", async () => {
    const sources = ["memory", "bob", "bizpulse", "research"].map(
      (sourceName, sourceIndex): ConversationContextSource => ({
        id: sourceName,
        inspect: () =>
          Promise.resolve(
            Array.from({ length: 8 }, (_, itemIndex) =>
              candidate({
                sourceId: `${sourceName}-${itemIndex}`,
                content: `${sourceName} candidate ${itemIndex}`,
                sourceType:
                  sourceIndex === 0
                    ? "memory_seed"
                    : sourceIndex === 1
                      ? "bob_work_item"
                      : sourceIndex === 2
                        ? "bizpulse_venture"
                        : "research_vault_source",
              }),
            ),
          ),
      }),
    );

    const collected = await collectContextCandidates(sources, {
      query: "candidate",
      limitPerSource: 8,
    });
    const globallyCapped = collected.candidates.slice(0, 24);

    for (const sourceName of ["memory", "bob", "bizpulse", "research"]) {
      expect(
        globallyCapped.filter(({ sourceId }) =>
          sourceId.startsWith(`${sourceName}-`),
        ),
      ).toHaveLength(6);
    }
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
        expect(JSON.parse(String(init?.body))).toMatchObject({
          statuses: expect.arrayContaining(["draft", "planned"]),
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
      "bizpulse_venture",
      "forgegraph_changeset",
      "kanbanger_issue",
      "bizpulse_venture",
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

  it("keeps BizPulse focus work in a bounded pack when venture keywords also match", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("/api/trpc/startup.list")) {
        return Response.json({
          result: {
            data: {
              json: Array.from({ length: 12 }, (_, index) => ({
                id: `venture-${index + 1}`,
                name: `Startup ${index + 1}`,
                lifecycleStage: "active",
                portfolioRole: "venture",
              })),
            },
          },
        });
      }
      if (url.includes("/api/trpc/focusQueue.list")) {
        return Response.json({
          result: {
            data: {
              json: Array.from({ length: 10 }, (_, index) => ({
                id: `focus-${index + 1}`,
                startupName: `Startup ${index + 1}`,
                priority: "high",
                question: `What is the next portfolio focus ${index + 1}?`,
              })),
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const [source] = createConfiguredContextSources(
      {
        bizpulse: {
          apiUrl: "https://pulse.example",
          apiKey: "biz-key",
        },
      },
      fetchMock,
    );

    const result = await source!.inspect({
      query: "venture",
      limitPerSource: 8,
    });

    expect(result).toHaveLength(8);
    expect(
      result.filter(({ sourceId }) => sourceId.startsWith("focus:")),
    ).toHaveLength(4);
    expect(
      result.filter(({ sourceId }) => !sourceId.startsWith("focus:")),
    ).toHaveLength(4);
  });

  it("normalizes authenticated research-vault results with server-classified sensitivity", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/search/sources");
      expect(url.searchParams.get("query")).toBe("voice memory");
      expect(url.searchParams.get("limit")).toBe("8");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer research-secret",
      });
      return Response.json({
        fallback: false,
        sources: [
          {
            source_id: 41,
            kind: "youtube",
            title: "Voice interfaces",
            excerpt: "Public research about conversational interfaces.",
            url: "https://youtube.example/watch?v=41",
            author: "Researcher",
            source_ts: "2026-08-01T12:00:00+00:00",
            score: 0.91,
            sensitivity: "general",
          },
          {
            source_id: 42,
            kind: "chat-import",
            title: "Prior private brainstorm",
            excerpt: "A personal note about voice-first memory.",
            url: null,
            author: null,
            source_ts: null,
            score: 0.88,
            sensitivity: "personal",
          },
        ],
      });
    });
    const [source] = createConfiguredContextSources(
      {
        researchVault: {
          apiUrl: "https://research.example",
          serviceToken: "research-secret",
        },
      },
      fetchMock,
    );

    const result = await source!.inspect({
      query: "voice memory",
      limitPerSource: 8,
    });

    expect(result).toEqual([
      expect.objectContaining({
        sourceType: "research_vault_source",
        sourceId: "41",
        sensitivity: "general",
        content: expect.stringContaining("Voice interfaces"),
      }),
      expect.objectContaining({
        sourceType: "research_vault_source",
        sourceId: "42",
        sensitivity: "personal",
        content: expect.stringContaining("Prior private brainstorm"),
      }),
    ]);
  });

  it("bounds research-vault queries before crossing the service boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      expect(url.searchParams.get("query")).toHaveLength(4_000);
      return Response.json({ fallback: true, sources: [] });
    });
    const [source] = createConfiguredContextSources(
      {
        researchVault: {
          apiUrl: "https://research.example",
          serviceToken: "research-secret",
        },
      },
      fetchMock,
    );

    await source!.inspect({ query: "q".repeat(8_000), limitPerSource: 8 });
  });
});

import { initTRPC, TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db client to avoid needing DATABASE_URL at import time.
vi.mock("@gmacko/ooda/db/client", () => ({
  db: {},
}));

// Mock session auth so authedProcedure passes without a real DB session.
vi.mock("@gmacko/ooda/db/auth", () => ({
  validateSessionToken: vi.fn().mockResolvedValue({ userId: "test-user", email: "test@example.com" }),
  extractSessionToken: vi.fn().mockReturnValue("mock-session-token"),
  SessionNotFoundError: class SessionNotFoundError extends Error {
    constructor() { super("Session not found or expired"); this.name = "SessionNotFoundError"; }
  },
}));

const { researchRouter } = await import("../research");

describe("researchRouter", () => {
  it("exports the router object", () => {
    expect(researchRouter).toBeDefined();
    expect(typeof researchRouter).toBe("object");
  });

  it("has expected query procedures", () => {
    const expectedQueries = [
      "health",
      "searchPapers",
      "listKbs",
      "getKb",
      "listSources",
      "diveStatus",
      "diveResults",
      "graphByThread",
      "paperNeighborhood",
      "paperPath",
      "papersSearchVault",
      "paperById",
      "threadMemorySearch",
      "toolLogsByThread",
      "inboxByThread",
      "linksByThread",
      "coldThreadUpdatesByThread",
      "inboxVaultWide",
      "divesRecent",
      "graphStats",
      "embeddingStats",
      "listTopics",
      "getTopicSources",
    ];
    for (const name of expectedQueries) {
      expect(researchRouter).toHaveProperty(name);
      expect((researchRouter as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("has expected mutation procedures", () => {
    const expectedMutations = [
      "compileKb",
      "importChats",
      "diveSpawn",
      "inboxTriage",
      "interestRegister",
      "interestUpdate",
      "interestDisable",
      "kbPromoteRequest",
      "threadMemoryUpdate",
      "toolCallLogInsert",
      "toolCallLogFinish",
      "runEmbedding",
      "runClustering",
    ];
    for (const name of expectedMutations) {
      expect(researchRouter).toHaveProperty(name);
      expect((researchRouter as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("has exactly the expected procedure count", () => {
    const procedureNames = Object.keys(researchRouter);
    expect(procedureNames).toHaveLength(40);
    expect(procedureNames.sort()).toEqual([
      "coldThreadUpdatesByThread",
      "compileKb",
      "diveResults",
      "diveSpawn",
      "diveStatus",
      "divesRecent",
      "embeddingStats",
      "entityIndex",
      "getKb",
      "getTopicSources",
      "graphByThread",
      "graphStats",
      "health",
      "importChats",
      "inboxByThread",
      "inboxTriage",
      "inboxVaultWide",
      "interestDisable",
      "interestList",
      "interestRegister",
      "interestUpdate",
      "kbPromoteRequest",
      "linksByThread",
      "listKbs",
      "listSources",
      "listTopics",
      "notesByEntity",
      "paperById",
      "paperNeighborhood",
      "paperPath",
      "papersSearchVault",
      "relatedNotes",
      "runClustering",
      "runEmbedding",
      "searchPapers",
      "threadMemorySearch",
      "threadMemoryUpdate",
      "toolCallLogFinish",
      "toolCallLogInsert",
      "toolLogsByThread",
    ]);
  });
});

// --- research.dive* procedures ------------------------------------------

/**
 * Build a minimal tRPC caller around `researchRouter` so tests can invoke
 * procedures end-to-end (through input validation, error mapping, and
 * return-value translation). We re-create a tRPC instance here rather than
 * pulling the full `appRouter` to keep the test hermetic: no Drizzle
 * schemas touched, no other routers imported.
 */
const t = initTRPC.context<{ db: unknown; headers: Headers }>().create();
const testRouter = t.router({ research: researchRouter });
const createCallerRaw = t.createCallerFactory(testRouter);

// Default headers for test callers. The `@gmacko/ooda/db/auth` mock above makes
// `extractSessionToken` return a token and `validateSessionToken` resolve
// for every request, so no real session is needed.
const defaultHeaders = () => new Headers({ host: "localhost:3100" });
const createCaller = (
  ctx: { db: unknown; headers?: Headers },
) => createCallerRaw({ headers: defaultHeaders(), ...ctx });

// --- Task 4.5: vault-scope middleware -----------------------------------

describe("withVaultScope middleware (Task 4.5)", () => {
  it("attaches ctx.vaultSchema = 'research_vault' for vaultScopedProcedure calls", async () => {
    const { vaultScopedProcedure } = await import(
      "../../middleware/vault-scope"
    );
    // Ad-hoc probe: a vault-scoped procedure that just echoes ctx.vaultSchema
    // so we can observe what the middleware attached.
    const probeRouter = t.router({
      probe: vaultScopedProcedure.query(({ ctx }) => ({
        vaultSchema: (ctx as { vaultSchema?: unknown }).vaultSchema,
      })),
    });
    const probeCaller = t.createCallerFactory(probeRouter)({
      db: {},
      headers: defaultHeaders(),
    });
    const result = await probeCaller.probe();
    expect(result).toEqual({ vaultSchema: "research_vault" });
  });

  it("pins to 'research_vault' regardless of threadId in input (V1.5 scope)", async () => {
    const { vaultScopedProcedure } = await import(
      "../../middleware/vault-scope"
    );
    const { z: zod } = await import("zod");
    const probeRouter = t.router({
      probe: vaultScopedProcedure
        .input(zod.object({ threadId: zod.string().uuid() }))
        .query(({ ctx }) => ({
          vaultSchema: (ctx as { vaultSchema?: unknown }).vaultSchema,
        })),
    });
    const probeCaller = t.createCallerFactory(probeRouter)({
      db: {},
      headers: defaultHeaders(),
    });
    const result = await probeCaller.probe({
      threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
    });
    expect(result).toEqual({ vaultSchema: "research_vault" });
  });
});

function makeFetchMock() {
  const mock = vi.fn();
  vi.stubGlobal("fetch", mock);
  return mock;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ detail: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

describe("research.dive* procedures", () => {
  const OLD_ENV = process.env.RESEARCH_API_URL;

  beforeEach(() => {
    process.env.RESEARCH_API_URL = "http://test.local";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.RESEARCH_API_URL = OLD_ENV;
  });

  // ---- diveSpawn --------------------------------------------------------

  it("diveSpawn posts a snake_case body to /dives with input + defaults", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        exploration_id: "2e683c3a-6046-42ac-adff-ee5c67070f17",
        status: "queued",
      }),
    );

    const caller = createCaller({ db: {} });
    const result = await caller.research.diveSpawn({
      threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
      seeds: ["10.1234/foo", "arxiv:2401.00001"],
      // budgetPapers, budgetSeconds, focus all rely on Zod defaults
    });

    expect(result).toEqual({
      exploration_id: "2e683c3a-6046-42ac-adff-ee5c67070f17",
      status: "queued",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("http://test.local/dives");
    expect(call[1]).toMatchObject({ method: "POST" });
    expect(call[1].headers).toMatchObject({
      "Content-Type": "application/json",
    });
    const body = JSON.parse(call[1].body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      thread_id: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
      seeds: ["10.1234/foo", "arxiv:2401.00001"],
      budget_papers: 60,
      budget_seconds: 180,
      focus: "balanced",
      vault_schema: "research_vault",
    });
  });

  it("diveSpawn rejects empty seeds array via Zod", async () => {
    const caller = createCaller({ db: {} });
    await expect(
      caller.research.diveSpawn({
        threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
        seeds: [],
      }),
    ).rejects.toThrow();
  });

  it("diveSpawn rejects budget_papers below the allowed range", async () => {
    const caller = createCaller({ db: {} });
    await expect(
      caller.research.diveSpawn({
        threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
        seeds: ["seed-1"],
        budgetPapers: 1,
      }),
    ).rejects.toThrow();
  });

  it("diveSpawn rejects budget_seconds above the allowed range", async () => {
    const caller = createCaller({ db: {} });
    await expect(
      caller.research.diveSpawn({
        threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
        seeds: ["seed-1"],
        budgetSeconds: 10_000,
      }),
    ).rejects.toThrow();
  });

  // ---- diveStatus -------------------------------------------------------

  it("diveStatus maps 404 to TRPCError NOT_FOUND", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValueOnce(notFoundResponse());

    const caller = createCaller({ db: {} });
    await expect(
      caller.research.diveStatus({
        id: "0a97ce81-92c1-4b71-b86f-4b071fddfbf6",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("diveStatus returns the parsed row on success", async () => {
    const fetchMock = makeFetchMock();
    const row = {
      id: "20ec80db-9670-4f26-a151-b3c51a2ba688",
      thread_id: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
      seed: ["seed-1"],
      budget_papers: 60,
      budget_seconds: 180,
      status: "running",
      started_at: "2026-04-19T00:00:00Z",
      finished_at: null,
      summary_md: null,
      meta: { focus: "balanced", vault_schema: "research_vault" },
      errors_json: null,
      error_md: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(row));

    const caller = createCaller({ db: {} });
    const res = await caller.research.diveStatus({
      id: "20ec80db-9670-4f26-a151-b3c51a2ba688",
    });
    expect(res).toEqual(row);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as [string];
    expect(call[0]).toBe(
      "http://test.local/dives/20ec80db-9670-4f26-a151-b3c51a2ba688",
    );
  });

  // ---- diveResults ------------------------------------------------------

  it("diveResults maps 404 to TRPCError NOT_FOUND", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValueOnce(notFoundResponse());

    const caller = createCaller({ db: {} });
    await expect(
      caller.research.diveResults({
        id: "32e7f170-aaa7-4eeb-aca7-3676e2d23825",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("diveResults uses topK=10 by default and returns the backend body", async () => {
    const fetchMock = makeFetchMock();
    const results = {
      exploration_id: "e9370450-4859-4237-974c-4f7446e7414c",
      status: "done",
      summary_md: "# Summary",
      papers: [
        {
          source_id: 1,
          title: "A Paper",
          authors: "Alice",
          year: 2024,
          influence_score: 0.9,
          reason: "high-influence",
        },
      ],
      clusters: [],
      edge_counts_by_kind: { cites: 3 },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(results));

    const caller = createCaller({ db: {} });
    const res = await caller.research.diveResults({
      id: "e9370450-4859-4237-974c-4f7446e7414c",
    });
    expect(res).toEqual(results);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as [string];
    expect(call[0]).toBe(
      "http://test.local/dives/e9370450-4859-4237-974c-4f7446e7414c/results?top_k=10",
    );
  });

  it("diveResults forwards an explicit topK value", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        exploration_id: "11c4f9ec-fb4a-4e33-a0ed-6d20995ec598",
        status: "done",
        summary_md: null,
        papers: [],
        clusters: [],
        edge_counts_by_kind: {},
      }),
    );

    const caller = createCaller({ db: {} });
    await caller.research.diveResults({
      id: "11c4f9ec-fb4a-4e33-a0ed-6d20995ec598",
      topK: 25,
    });
    const call = fetchMock.mock.calls[0] as [string];
    expect(call[0]).toBe(
      "http://test.local/dives/11c4f9ec-fb4a-4e33-a0ed-6d20995ec598/results?top_k=25",
    );
  });

  // ---- env handling -----------------------------------------------------

  it("diveSpawn throws PRECONDITION_FAILED when RESEARCH_API_URL is not set", async () => {
    delete process.env.RESEARCH_API_URL;
    const caller = createCaller({ db: {} });
    await expect(
      caller.research.diveSpawn({
        threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
        seeds: ["seed-1"],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // TRPCError is re-exported from @trpc/server; smoke check that the
    // thrown error is still recognizable as such.
    try {
      await caller.research.diveSpawn({
        threadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
        seeds: ["seed-1"],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
    }
  });
});

// --- Task 4.2 read procedures ------------------------------------------

/**
 * The Task 4.2 procedures build Drizzle queries whose final thenable is
 * the result of `.limit(n)`. We mock `ctx.db` as a proxy chain that
 * records every method call and — on the terminal step (usually `.limit`)
 * — resolves to a pre-scripted array of rows.
 *
 * A test scripts `queryRows` in the order procedures issue them. For
 * `graphByThread` that's [edges, nodes]; for single-query procedures
 * it's just [rows]. The mock also exposes the last chain so tests can
 * assert on things like the LIMIT that was applied.
 */
interface ChainCall {
  method: string;
  args: unknown[];
}

function createMockDb(queryRows: unknown[][]) {
  const chains: ChainCall[][] = [];
  let cursor = 0;

  function newChain(entry: string, entryArgs: unknown[]): unknown {
    const calls: ChainCall[] = [{ method: entry, args: entryArgs }];
    chains.push(calls);

    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          // Terminal: resolve with the next scripted rowset.
          const rows = queryRows[cursor++] ?? [];
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return proxy;
        };
      },
    };

    const proxy: unknown = new Proxy({}, handler);
    return proxy;
  }

  return {
    db: {
      select: (...args: unknown[]) => newChain("select", args),
      update: (...args: unknown[]) => newChain("update", args),
      insert: (...args: unknown[]) => newChain("insert", args),
    },
    chains,
    // The `inArray(..., ctx.db.select(...))` subquery itself builds its own
    // chain; tests that care can inspect that via `chains`.
  };
}

describe("researchRouter read procedures (Task 4.2)", () => {
  const THREAD_ID = "43ebcb62-915e-48b6-a628-afc4ae467cab";
  const OTHER_THREAD_ID = "5d53c4c8-4e8d-4914-b379-a0d75b223acc";

  it("graphByThread returns empty arrays for thread with no explorations", async () => {
    // edges query resolves to [] → early return; node query never runs.
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    const result = await caller.research.graphByThread({
      threadId: THREAD_ID,
    });
    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it("graphByThread returns nodes+edges joined from edge endpoints", async () => {
    const edges = [
      { fromSourceId: 1, toSourceId: 2, kind: "cites", weight: 0.8 },
      { fromSourceId: 2, toSourceId: 3, kind: "references", weight: null },
    ];
    const nodes = [
      {
        sourceId: 1,
        title: "Paper A",
        author: "Alice",
        sourceTs: new Date("2023-06-01T00:00:00Z"),
        influenceScore: 0.9,
        s2PaperId: "s2:1",
      },
      {
        sourceId: 2,
        title: "Paper B",
        author: null,
        sourceTs: null,
        influenceScore: null,
        s2PaperId: null,
      },
      {
        sourceId: 3,
        title: "Paper C",
        author: "Carol",
        sourceTs: new Date("2024-11-15T00:00:00Z"),
        influenceScore: 0.5,
        s2PaperId: "s2:3",
      },
    ];
    const { db, chains } = createMockDb([edges, nodes]);
    const caller = createCaller({ db });
    const result = await caller.research.graphByThread({
      threadId: THREAD_ID,
    });

    expect(result.edges).toEqual([
      {
        fromSourceId: 1,
        toSourceId: 2,
        kind: "cites",
        weight: 0.8,
      },
      {
        fromSourceId: 2,
        toSourceId: 3,
        kind: "references",
        weight: null,
      },
    ]);
    expect(result.nodes).toEqual([
      {
        sourceId: 1,
        title: "Paper A",
        author: "Alice",
        year: 2023,
        influenceScore: 0.9,
        s2PaperId: "s2:1",
      },
      {
        sourceId: 2,
        title: "Paper B",
        author: null,
        year: null,
        influenceScore: null,
        s2PaperId: null,
      },
      {
        sourceId: 3,
        title: "Paper C",
        author: "Carol",
        year: 2024,
        influenceScore: 0.5,
        s2PaperId: "s2:3",
      },
    ]);

    // The outermost queries should have applied the documented caps.
    // There are 3 ctx.db.select() calls in play: edges, the inArray
    // subquery, and nodes. Find the ones whose final chain is `limit`
    // and assert the numbers.
    const limits = chains
      .map((c) => c.find((call) => call.method === "limit"))
      .filter((x): x is ChainCall => x !== undefined)
      .map((call) => call.args[0]);
    // Must include both documented caps somewhere in the query set.
    expect(limits).toContain(2000);
    expect(limits).toContain(500);
  });

  it("graphByThread honours the 500-node / 2000-edge caps at query time", async () => {
    const { db, chains } = createMockDb([[]]);
    const caller = createCaller({ db });
    await caller.research.graphByThread({ threadId: THREAD_ID });

    // The edge query — the first and only executed query for an empty
    // thread — must have been capped at 2000.
    const edgeLimit = chains[0]!.find((c) => c.method === "limit");
    expect(edgeLimit).toBeDefined();
    expect(edgeLimit!.args[0]).toBe(2000);
  });

  it("toolLogsByThread returns rows with computed durationMs", async () => {
    const started = new Date("2026-04-19T10:00:00Z");
    const finished = new Date("2026-04-19T10:00:03Z");
    const rows = [
      {
        id: "a",
        toolName: "graph.neighbors",
        args: { paperId: "p1" },
        resultSummary: "ok",
        startedAt: finished, // newest first
        finishedAt: null,
        error: null,
      },
      {
        id: "b",
        toolName: "dive.spawn",
        args: { seeds: ["s1"] },
        resultSummary: "spawned",
        startedAt: started,
        finishedAt: finished,
        error: null,
      },
    ];
    const { db, chains } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.toolLogsByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.durationMs).toBeNull();
    expect(result.items[1]!.durationMs).toBe(3000);
    // The one query executed should have applied an ORDER BY + LIMIT.
    const c = chains[0]!;
    expect(c.find((x) => x.method === "orderBy")).toBeDefined();
    const limit = c.find((x) => x.method === "limit");
    expect(limit!.args[0]).toBe(50);
  });

  it("toolLogsByThread rejects limit above the 200 cap", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.toolLogsByThread({
        threadId: THREAD_ID,
        limit: 500,
      }),
    ).rejects.toThrow();
  });

  it("toolLogsByThread forwards `since` into the where clause", async () => {
    const since = new Date("2026-04-01T00:00:00Z");
    const { db, chains } = createMockDb([[]]);
    const caller = createCaller({ db });
    await caller.research.toolLogsByThread({
      threadId: THREAD_ID,
      since,
    });
    // The builder's where() was called once with a combined expression —
    // we can't easily crack open a Drizzle SQL fragment here, but we can
    // assert the call happened. The presence of `since` is tested more
    // strongly by typechecking: only when `since` is present does the
    // second condition get pushed.
    const whereCall = chains[0]!.find((x) => x.method === "where");
    expect(whereCall).toBeDefined();
  });

  it("inboxByThread (triage=pending default) applies the filter + ordering", async () => {
    const rows = [
      {
        id: "inbox-1",
        sourceId: 10,
        title: "Found Paper",
        author: "Eve",
        sourceTs: new Date("2025-03-01T00:00:00Z"),
        reasonMd: "matches your interest",
        score: 0.42,
        foundAt: new Date("2026-04-18T12:00:00Z"),
        triage: "pending",
        standingInterestLabel: "sleep science",
      },
    ];
    const { db, chains } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.inboxByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toEqual([
      {
        id: "inbox-1",
        sourceId: 10,
        title: "Found Paper",
        author: "Eve",
        year: 2025,
        reasonMd: "matches your interest",
        score: 0.42,
        foundAt: new Date("2026-04-18T12:00:00Z"),
        triage: "pending",
        standingInterestLabel: "sleep science",
      },
    ]);
    const c = chains[0]!;
    // Expected join structure: innerJoin sources + innerJoin
    // standing_interest. We dropped the leftJoin deliberately (orphan
    // finding rows would otherwise leak into every thread's inbox via
    // the isNull threadId branch).
    const innerJoins = c.filter((x) => x.method === "innerJoin");
    expect(innerJoins.length).toBe(2);
    expect(c.find((x) => x.method === "leftJoin")).toBeUndefined();
    expect(c.find((x) => x.method === "orderBy")).toBeDefined();
  });

  it("inboxByThread (triage=all) drops the triage filter", async () => {
    // We can't easily introspect the SQL expression, but the shape of
    // the query (single call to `.where`) should still be intact.
    const { db, chains } = createMockDb([[]]);
    const caller = createCaller({ db });
    await caller.research.inboxByThread({
      threadId: THREAD_ID,
      triage: "all",
    });
    const c = chains[0]!;
    expect(c.find((x) => x.method === "where")).toBeDefined();
  });

  it("inboxByThread includes vault-global interests (thread_id IS NULL)", async () => {
    // Vault-global interests have standing_interest.thread_id = NULL on
    // the joined row itself. After the switch from LEFT JOIN to INNER
    // JOIN, the interest row IS present — the label column is non-null,
    // only the interest's thread_id is null. The dashboard still
    // surfaces the finding because the WHERE clause's OR branch matches
    // `standing_interest.thread_id IS NULL`.
    const rows = [
      {
        id: "inbox-global",
        sourceId: 11,
        title: "Global Interest Hit",
        author: null,
        sourceTs: null,
        reasonMd: null,
        score: null,
        foundAt: new Date("2026-04-18T12:00:00Z"),
        triage: "pending",
        standingInterestLabel: "vault-wide feed",
      },
    ];
    const { db } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.inboxByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.standingInterestLabel).toBe("vault-wide feed");
  });

  it("linksByThread flips endpoints so `otherThread*` is always the other side", async () => {
    const discoveredAt = new Date("2026-04-18T09:00:00Z");
    const rows = [
      // Thread is the FROM side → other = to_thread.
      {
        fromThreadId: THREAD_ID,
        toThreadId: OTHER_THREAD_ID,
        fromTitle: "This Thread",
        toTitle: "Other Thread",
        kind: "topic_overlap",
        score: 0.7,
        reasonMd: "shared topic",
        discoveredAt,
      },
      // Thread is the TO side → other = from_thread.
      {
        fromThreadId: OTHER_THREAD_ID,
        toThreadId: THREAD_ID,
        fromTitle: "Inbound Thread",
        toTitle: "This Thread",
        kind: "citation_overlap",
        score: 0.5,
        reasonMd: "shared cites",
        discoveredAt,
      },
    ];
    const { db } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.linksByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toEqual([
      {
        otherThreadId: OTHER_THREAD_ID,
        otherThreadTitle: "Other Thread",
        kind: "topic_overlap",
        score: 0.7,
        reasonMd: "shared topic",
        discoveredAt,
      },
      {
        otherThreadId: OTHER_THREAD_ID,
        otherThreadTitle: "Inbound Thread",
        kind: "citation_overlap",
        score: 0.5,
        reasonMd: "shared cites",
        discoveredAt,
      },
    ]);
  });

  it("linksByThread returns empty items for a thread with no synergies", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    const result = await caller.research.linksByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toEqual([]);
  });
});

// --- Session auth guard on sensitive mutations ----------------------------

describe("researchRouter session auth guard", () => {
  // Write-side buddy mutations are gated on `authedProcedure` so
  // unauthenticated callers cannot mutate another user's rows.
  // When `extractSessionToken` returns null, the procedure rejects
  // with UNAUTHORIZED before any tRPC resolver runs.
  it("rejects inboxTriage from an unauthenticated caller with UNAUTHORIZED", async () => {
    // Temporarily override the mock to simulate missing token.
    const authMock = await import("@gmacko/ooda/db/auth");
    const extractMock = vi.mocked(authMock.extractSessionToken);
    extractMock.mockReturnValueOnce(null);

    const unauthCaller = createCallerRaw({
      db: {},
      headers: new Headers({ host: "ooda.example.com" }),
    });
    await expect(
      unauthCaller.research.inboxTriage({
        id: "3a4b6a8c-1122-4cdd-9eef-abcdef012345",
        action: "save",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// --- Task 4.3 write procedures -----------------------------------------

describe("researchRouter write procedures (Task 4.3)", () => {
  const THREAD_ID = "43ebcb62-915e-48b6-a628-afc4ae467cab";
  const INBOX_ID = "3a4b6a8c-1122-4cdd-9eef-abcdef012345";
  const INTEREST_ID = "7b8c9d01-2233-4eef-8abc-def012345678";

  // ---- inboxTriage ------------------------------------------------------

  it.each([
    ["save", "saved"],
    ["dismiss", "dismissed"],
    ["promote", "promoted"],
  ] as const)(
    "inboxTriage maps action=%s to triage=%s",
    async (action, expectedTriage) => {
      const returnRow = {
        id: INBOX_ID,
        triage: expectedTriage,
        triageAt: new Date("2026-04-19T12:00:00Z"),
      };
      const { db, chains } = createMockDb([[returnRow]]);
      const caller = createCaller({ db });
      const result = await caller.research.inboxTriage({
        id: INBOX_ID,
        action,
      });
      expect(result).toEqual({ ok: true, ...returnRow });

      // Confirm the `.set()` call was passed the translated enum value.
      const setCall = chains[0]!.find((c) => c.method === "set");
      expect(setCall).toBeDefined();
      const arg = setCall!.args[0] as { triage: string; triageAt: Date };
      expect(arg.triage).toBe(expectedTriage);
      expect(arg.triageAt).toBeInstanceOf(Date);
    },
  );

  it("inboxTriage throws NOT_FOUND when the id doesn't exist", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.inboxTriage({ id: INBOX_ID, action: "save" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("inboxTriage stamps triageAt with a fresh timestamp", async () => {
    const { db, chains } = createMockDb([
      [{ id: INBOX_ID, triage: "saved", triageAt: new Date() }],
    ]);
    const caller = createCaller({ db });
    const before = Date.now();
    await caller.research.inboxTriage({ id: INBOX_ID, action: "save" });
    const after = Date.now();

    const setCall = chains[0]!.find((c) => c.method === "set");
    const patched = setCall!.args[0] as { triageAt: Date };
    expect(patched.triageAt).toBeInstanceOf(Date);
    expect(patched.triageAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(patched.triageAt.getTime()).toBeLessThanOrEqual(after);
  });

  // ---- interestRegister -------------------------------------------------

  it("interestRegister inserts a new row with the provided fields", async () => {
    const returnRow = {
      id: INTEREST_ID,
      label: "sleep science",
      cadenceSeconds: 7200,
      enabled: true,
    };
    const { db, chains } = createMockDb([[returnRow]]);
    const caller = createCaller({ db });
    const result = await caller.research.interestRegister({
      threadId: THREAD_ID,
      label: "sleep science",
      queryTerms: ["sleep", "insomnia"],
      seedSourceIds: [1, 2, 3],
    });
    expect(result).toEqual(returnRow);

    const valuesCall = chains[0]!.find((c) => c.method === "values");
    expect(valuesCall).toBeDefined();
    const arg = valuesCall!.args[0] as Record<string, unknown>;
    expect(arg.label).toBe("sleep science");
    expect(arg.threadId).toBe(THREAD_ID);
    // vaultSchema should NOT leak into the INSERT payload.
    expect("vaultSchema" in arg).toBe(false);
  });

  it("interestRegister rejects cadence below the schema minimum", async () => {
    // CreateStandingInterestSchema pulls its `cadenceSeconds` bound from
    // the DB column, which is `integer().notNull().default(7200)`. The
    // insert schema doesn't enforce a lower bound, so we test the
    // `interestUpdate` cadence floor separately (below). Here we verify
    // that cadence is coerced to an integer — a float is rejected.
    const caller = createCaller({ db: createMockDb([]).db });
    await expect(
      caller.research.interestRegister({
        label: "bad cadence",
        cadenceSeconds: 1.5 as unknown as number,
      }),
    ).rejects.toThrow();
  });

  // ---- interestList -----------------------------------------------------

  it("interestList returns only thread-matching + global when threadId is given", async () => {
    const rows = [
      { id: "i1", threadId: THREAD_ID, label: "thread-scoped", enabled: true },
      { id: "i2", threadId: null, label: "vault-global", enabled: true },
    ];
    const { db, chains } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.interestList({ threadId: THREAD_ID });
    expect(result.items).toEqual(rows);
    // The query should have applied BOTH a where() (for the thread filter
    // OR is-null) AND an orderBy.
    const c = chains[0]!;
    expect(c.find((x) => x.method === "where")).toBeDefined();
    expect(c.find((x) => x.method === "orderBy")).toBeDefined();
  });

  it("interestList returns every interest when threadId is omitted", async () => {
    const rows = [
      { id: "i1", threadId: THREAD_ID, label: "a", enabled: true },
      { id: "i2", threadId: null, label: "b", enabled: false },
      { id: "i3", threadId: "other", label: "c", enabled: true },
    ];
    const { db, chains } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.interestList({});
    expect(result.items).toEqual(rows);
    // where() still gets called but with an undefined expr → effective
    // no-op; orderBy still applied.
    const c = chains[0]!;
    expect(c.find((x) => x.method === "orderBy")).toBeDefined();
  });

  // ---- interestUpdate ---------------------------------------------------

  it("interestUpdate patches only the fields that are provided", async () => {
    const returnRow = {
      id: INTEREST_ID,
      label: "renamed",
      enabled: true,
      cadenceSeconds: 7200,
    };
    const { db, chains } = createMockDb([[returnRow]]);
    const caller = createCaller({ db });
    const result = await caller.research.interestUpdate({
      id: INTEREST_ID,
      label: "renamed",
    });
    expect(result).toEqual(returnRow);

    const setCall = chains[0]!.find((c) => c.method === "set");
    const patch = setCall!.args[0] as Record<string, unknown>;
    expect(patch).toEqual({ label: "renamed" });
    expect("id" in patch).toBe(false);
    expect("vaultSchema" in patch).toBe(false);
    expect("enabled" in patch).toBe(false);
    expect("cadenceSeconds" in patch).toBe(false);
  });

  it("interestUpdate rejects an empty patch with BAD_REQUEST", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.interestUpdate({ id: INTEREST_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("interestUpdate throws NOT_FOUND when the id doesn't exist", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.interestUpdate({
        id: INTEREST_ID,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("interestUpdate rejects cadence below the 300s floor", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.interestUpdate({
        id: INTEREST_ID,
        cadenceSeconds: 60,
      }),
    ).rejects.toThrow();
  });

  // ---- interestDisable --------------------------------------------------

  it("interestDisable sets enabled=false and returns the updated row", async () => {
    const returnRow = {
      id: INTEREST_ID,
      label: "paused",
      enabled: false,
      cadenceSeconds: 7200,
    };
    const { db, chains } = createMockDb([[returnRow]]);
    const caller = createCaller({ db });
    const result = await caller.research.interestDisable({ id: INTEREST_ID });
    expect(result).toEqual(returnRow);

    const setCall = chains[0]!.find((c) => c.method === "set");
    expect(setCall!.args[0]).toEqual({ enabled: false });
  });

  it("interestDisable throws NOT_FOUND when the id doesn't exist", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.interestDisable({ id: INTEREST_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// --- Task 4.4 kbPromoteRequest -----------------------------------------

/**
 * kbPromoteRequest writes a file under `<vault>/drafts/<kbSlug>/<uuid>.md`.
 * These tests use a real tmpdir for the vault and drive the procedure
 * through the tRPC caller so input validation runs for real. We rely on
 * `@gmacko/ooda/vault`'s own `listDrafts` to read back the file we just wrote.
 */

const { mkdtempSync: realMkdtempSync, rmSync: realRmSync } = await import(
  "node:fs"
);
const { tmpdir: realTmpdir } = await import("node:os");
const { join: realJoin } = await import("node:path");
const vaultModule = await import("@gmacko/ooda/vault");

describe("researchRouter.kbPromoteRequest (Task 4.4)", () => {
  const OLD_VAULT = process.env.RESEARCH_VAULT_PATH;
  let vaultPath: string;

  // threadOwnerProcedure queries the DB for ownership. For happy-path
  // tests, return a row with ownerId: null (legacy unowned thread) so
  // any authed user passes the check.
  const PROMOTE_THREAD_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  function createOwnerMockDb() {
    return createMockDb([[{ ownerId: null }]]);
  }

  beforeEach(() => {
    vaultPath = realMkdtempSync(realJoin(realTmpdir(), "ooda-api-vault-"));
    process.env.RESEARCH_VAULT_PATH = vaultPath;
  });

  afterEach(() => {
    realRmSync(vaultPath, { recursive: true, force: true });
    if (OLD_VAULT === undefined) {
      delete process.env.RESEARCH_VAULT_PATH;
    } else {
      process.env.RESEARCH_VAULT_PATH = OLD_VAULT;
    }
  });

  it("writes a draft file to the vault and returns id+path+status", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    const result = await caller.research.kbPromoteRequest({
      threadId: PROMOTE_THREAD_ID,
      sourceIds: [1, 2, 3],
      kbSlug: "sleep-science",
      noteMd: "# Findings\n\nSome note body.",
    });

    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.relativePath).toBe(`drafts/sleep-science/${result.id}.md`);
    expect(result.status).toBe("pending");

    // File actually lands on disk via @gmacko/ooda/vault.
    const drafts = await vaultModule.listDrafts(vaultPath, "sleep-science");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(result.id);
    expect(drafts[0]!.kbSlug).toBe("sleep-science");
    expect(drafts[0]!.sourceIds).toEqual([1, 2, 3]);
    expect(drafts[0]!.status).toBe("pending");
    expect(drafts[0]!.body.trim()).toBe("# Findings\n\nSome note body.".trim());
  });

  it("persists createdByThreadId in frontmatter when provided", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    const threadId = "d0ae8aa6-4845-4088-af5f-bf63efd6b439";
    const result = await caller.research.kbPromoteRequest({
      threadId: PROMOTE_THREAD_ID,
      sourceIds: [7],
      kbSlug: "kb",
      noteMd: "body",
      createdByThreadId: threadId,
    });

    const drafts = await vaultModule.listDrafts(vaultPath, "kb");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(result.id);
    expect(drafts[0]!.createdByThreadId).toBe(threadId);
  });

  it("throws PRECONDITION_FAILED when RESEARCH_VAULT_PATH is unset", async () => {
    delete process.env.RESEARCH_VAULT_PATH;
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [1],
        kbSlug: "kb",
        noteMd: "body",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("throws PRECONDITION_FAILED when RESEARCH_VAULT_PATH is empty string", async () => {
    process.env.RESEARCH_VAULT_PATH = "   ";
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [1],
        kbSlug: "kb",
        noteMd: "body",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects empty sourceIds via Zod", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [],
        kbSlug: "kb",
        noteMd: "body",
      }),
    ).rejects.toThrow();
  });

  it("rejects sourceIds above the 50 cap via Zod", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    const tooMany = Array.from({ length: 51 }, (_, i) => i + 1);
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: tooMany,
        kbSlug: "kb",
        noteMd: "body",
      }),
    ).rejects.toThrow();
  });

  it("rejects non-integer sourceIds via Zod", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [1.5],
        kbSlug: "kb",
        noteMd: "body",
      }),
    ).rejects.toThrow();
  });

  it("rejects empty kbSlug", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [1],
        kbSlug: "",
        noteMd: "body",
      }),
    ).rejects.toThrow();
  });

  it("rejects empty noteMd", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [1],
        kbSlug: "kb",
        noteMd: "",
      }),
    ).rejects.toThrow();
  });

  it("rejects a non-uuid createdByThreadId", async () => {
    const caller = createCaller({ db: createOwnerMockDb().db });
    await expect(
      caller.research.kbPromoteRequest({
        threadId: PROMOTE_THREAD_ID,
        sourceIds: [1],
        kbSlug: "kb",
        noteMd: "body",
        createdByThreadId: "not-a-uuid",
      }),
    ).rejects.toThrow();
  });
});

// --- Task 7.2 coldThreadUpdatesByThread --------------------------------

/**
 * Cold-thread-updates computes dashboard updates for threads whose memory
 * has gone cold (>30 days). The procedure runs two queries: (1) look up
 * the cold thread_memory row, (2) fetch matching findings_inbox rows.
 * The mock db chains script both rowsets in order.
 */
describe("researchRouter.coldThreadUpdatesByThread (Task 7.2)", () => {
  const THREAD_ID = "43ebcb62-915e-48b6-a628-afc4ae467cab";

  it("returns empty when thread_memory is absent or warm", async () => {
    // No memory row → first query resolves to [] → early return.
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    const result = await caller.research.coldThreadUpdatesByThread({
      threadId: THREAD_ID,
    });
    expect(result).toEqual({ items: [] });
  });

  it("joins findings_inbox when memory is cold and returns items", async () => {
    const oldUpdatedAt = new Date("2025-01-01T00:00:00Z");
    const memoryRows = [
      {
        updatedAt: oldUpdatedAt,
        topicFingerprint: ["sleep", "insomnia"],
      },
    ];
    const foundAt = new Date("2026-04-15T12:00:00Z");
    const inboxRows = [
      {
        sourceId: 42,
        title: "Fresh finding",
        foundAt,
        reasonMd: "relevant",
      },
      {
        sourceId: 43,
        title: null,
        foundAt,
        reasonMd: null,
      },
    ];
    const { db, chains } = createMockDb([memoryRows, inboxRows]);
    const caller = createCaller({ db });
    const result = await caller.research.coldThreadUpdatesByThread({
      threadId: THREAD_ID,
    });

    expect(result.items).toEqual([
      {
        sourceId: 42,
        title: "Fresh finding",
        foundAt: foundAt.toISOString(),
        reasonMd: "relevant",
      },
      {
        sourceId: 43,
        title: "",
        foundAt: foundAt.toISOString(),
        reasonMd: "",
      },
    ]);

    // Second chain (the findings_inbox query) should include innerJoin
    // (sources) + leftJoin (standing_interest) + orderBy + limit.
    const inboxChain = chains[1]!;
    expect(inboxChain.find((c) => c.method === "innerJoin")).toBeDefined();
    expect(inboxChain.find((c) => c.method === "leftJoin")).toBeDefined();
    expect(inboxChain.find((c) => c.method === "orderBy")).toBeDefined();
    const limit = inboxChain.find((c) => c.method === "limit");
    expect(limit!.args[0]).toBe(50);
  });

  it("skips topic-overlap filter when fingerprint is empty", async () => {
    // Empty fingerprint → procedure should still query inbox but without
    // the arrayOverlaps predicate. We can't crack open the SQL expression
    // here, but we can verify the second query runs and returns data.
    const memoryRows = [
      {
        updatedAt: new Date("2025-01-01T00:00:00Z"),
        topicFingerprint: [],
      },
    ];
    const inboxRows = [
      {
        sourceId: 1,
        title: "Anything",
        foundAt: new Date("2026-04-18T00:00:00Z"),
        reasonMd: "no-topic-filter",
      },
    ];
    const { db } = createMockDb([memoryRows, inboxRows]);
    const caller = createCaller({ db });
    const result = await caller.research.coldThreadUpdatesByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.sourceId).toBe(1);
  });

  it("skips topic-overlap filter when fingerprint is null", async () => {
    const memoryRows = [
      {
        updatedAt: new Date("2025-01-01T00:00:00Z"),
        topicFingerprint: null,
      },
    ];
    const { db } = createMockDb([memoryRows, []]);
    const caller = createCaller({ db });
    const result = await caller.research.coldThreadUpdatesByThread({
      threadId: THREAD_ID,
    });
    expect(result.items).toEqual([]);
  });

  it("rejects non-uuid threadId via Zod", async () => {
    const { db } = createMockDb([]);
    const caller = createCaller({ db });
    await expect(
      caller.research.coldThreadUpdatesByThread({
        threadId: "not-a-uuid",
      }),
    ).rejects.toThrow();
  });
});

// --- Task 7.4 vault-wide landing procedures ----------------------------

describe("researchRouter.inboxVaultWide (Task 7.4)", () => {
  it("returns inbox items joined to sources and standing_interest", async () => {
    const foundAt = new Date("2026-04-19T10:00:00Z");
    const rows = [
      {
        id: "inbox-1",
        sourceId: 10,
        title: "Paper A",
        author: "Alice",
        sourceTs: new Date("2024-06-01T00:00:00Z"),
        reasonMd: "matches",
        score: 0.7,
        foundAt,
        triage: "pending",
        standingInterestLabel: "vault-wide interest",
      },
    ];
    const { db, chains } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.inboxVaultWide({});
    expect(result.items).toEqual([
      {
        id: "inbox-1",
        sourceId: 10,
        title: "Paper A",
        author: "Alice",
        year: 2024,
        reasonMd: "matches",
        score: 0.7,
        foundAt,
        triage: "pending",
        standingInterestLabel: "vault-wide interest",
      },
    ]);
    const c = chains[0]!;
    expect(c.find((x) => x.method === "innerJoin")).toBeDefined();
    expect(c.find((x) => x.method === "leftJoin")).toBeDefined();
    const limit = c.find((x) => x.method === "limit");
    expect(limit!.args[0]).toBe(50);
  });

  it("rejects limit above the 200 cap via Zod", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.inboxVaultWide({ limit: 500 }),
    ).rejects.toThrow();
  });

  it("forwards `since` through to the where clause", async () => {
    const since = new Date("2026-04-01T00:00:00Z");
    const { db, chains } = createMockDb([[]]);
    const caller = createCaller({ db });
    await caller.research.inboxVaultWide({ since });
    const c = chains[0]!;
    expect(c.find((x) => x.method === "where")).toBeDefined();
  });
});

describe("researchRouter.divesRecent (Task 7.4)", () => {
  it("returns graph_exploration rows with computed elapsedMs", async () => {
    const startedAt = new Date("2026-04-19T09:00:00Z");
    const finishedAt = new Date("2026-04-19T09:00:05Z");
    const rows = [
      {
        id: "dive-1",
        threadId: "43ebcb62-915e-48b6-a628-afc4ae467cab",
        seed: ["seed-1"],
        status: "done",
        budgetPapers: 60,
        budgetSeconds: 180,
        startedAt,
        finishedAt,
      },
      {
        id: "dive-2",
        threadId: "43ebcb62-915e-48b6-a628-afc4ae467cab",
        seed: ["seed-2"],
        status: "queued",
        budgetPapers: 60,
        budgetSeconds: 180,
        startedAt: null,
        finishedAt: null,
      },
    ];
    const { db, chains } = createMockDb([rows]);
    const caller = createCaller({ db });
    const result = await caller.research.divesRecent({});
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.elapsedMs).toBe(5000);
    expect(result.items[1]!.elapsedMs).toBeNull();
    const c = chains[0]!;
    expect(c.find((x) => x.method === "orderBy")).toBeDefined();
    const limit = c.find((x) => x.method === "limit");
    expect(limit!.args[0]).toBe(20);
  });

  it("rejects sinceDays above the 90-day cap via Zod", async () => {
    const { db } = createMockDb([[]]);
    const caller = createCaller({ db });
    await expect(
      caller.research.divesRecent({ sinceDays: 365 }),
    ).rejects.toThrow();
  });
});

describe("researchRouter.graphStats (Task 7.4)", () => {
  it("returns aggregated counters plus per-kind edge breakdown", async () => {
    // Four concurrent queries: nodes, edges, sources, edge-kind groupBy.
    const queryRows: unknown[][] = [
      [{ c: 12 }],
      [{ c: 34 }],
      [{ c: 56 }],
      [
        { kind: "cites", c: 20 },
        { kind: "references", c: 14 },
      ],
    ];
    const { db } = createMockDb(queryRows);
    const caller = createCaller({ db });
    const result = await caller.research.graphStats({});
    expect(result).toEqual({
      totalNodes: 12,
      totalEdges: 34,
      totalSources: 56,
      edgesByKind: { cites: 20, references: 14 },
    });
  });

  it("returns zeros when the vault is empty", async () => {
    const queryRows: unknown[][] = [[], [], [], []];
    const { db } = createMockDb(queryRows);
    const caller = createCaller({ db });
    const result = await caller.research.graphStats({});
    expect(result).toEqual({
      totalNodes: 0,
      totalEdges: 0,
      totalSources: 0,
      edgesByKind: {},
    });
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  cp_open_url,
  dive_results,
  dive_spawn,
  dive_status,
  graph_neighborhood,
  graph_path,
  inbox_list,
  inbox_triage,
  interest_disable,
  interest_list,
  interest_register,
  kb_promote_request,
  paper_get,
  PaperIdSchema,
  papers_search,
  thread_links_suggest,
  thread_memory_search,
  thread_memory_update,
  TOOL_NAMES,
  ToolResultSchema,
  TOOLS,
  TOOLS_IMPLEMENTED,
  TOOLS_PLANNED,
} from "../index";

// All 17 tool schemas are now IMPLEMENTED — TOOLS_PLANNED is empty in
// V1.5. If a future schema lands without a backing procedure, add it to
// TOOLS_PLANNED in schemas.ts and this assertion will surface the gap.
const EXPECTED_TOOLS = [
  "dive_spawn",
  "dive_status",
  "dive_results",
  "papers_search",
  "paper_get",
  "graph_neighborhood",
  "graph_path",
  "thread_memory_search",
  "thread_memory_update",
  "thread_links_suggest",
  "interest_register",
  "interest_list",
  "interest_disable",
  "inbox_list",
  "inbox_triage",
  "kb_promote_request",
  "cp_open_url",
] as const;

// A fixed v4 UUID used across tests.
const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("TOOLS registry", () => {
  it("contains all 17 implemented tool names", () => {
    expect(TOOL_NAMES.length).toBe(17);
    expect(new Set(TOOL_NAMES)).toEqual(new Set(EXPECTED_TOOLS));
  });

  it("every entry has matching { name, description, args, result }", () => {
    for (const [key, tool] of Object.entries(TOOLS)) {
      expect(tool.name).toBe(key);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      // Zod schemas expose a .parse method; that's enough of a shape check
      // without reaching into Zod internals.
      expect(typeof tool.args.parse).toBe("function");
      expect(typeof tool.result.parse).toBe("function");
    }
  });

  it("every tool.args is a ZodObject (can enumerate keys)", () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.args).toBeInstanceOf(z.ZodObject);
    }
  });

  it("every tool.result is a ZodObject", () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.result).toBeInstanceOf(z.ZodObject);
    }
  });

  it("TOOLS_IMPLEMENTED and TOOLS_PLANNED are disjoint", () => {
    const implemented = new Set(Object.keys(TOOLS_IMPLEMENTED));
    const planned = Object.keys(TOOLS_PLANNED);
    for (const name of planned) {
      expect(implemented.has(name)).toBe(false);
    }
  });

  it("TOOLS === TOOLS_IMPLEMENTED in V1.5 (planned tools stay hidden)", () => {
    // If this ever flips to a superset, update the test + bump the
    // agent-facing tool catalog docs. Planned tools getting exposed
    // without their backing tRPC procedure is exactly the bug this
    // split was introduced to prevent.
    expect(Object.keys(TOOLS).sort()).toEqual(
      Object.keys(TOOLS_IMPLEMENTED).sort(),
    );
  });

  it("TOOLS_PLANNED is empty now that every schema has real backing", () => {
    expect(Object.keys(TOOLS_PLANNED)).toEqual([]);
  });
});

describe("ToolResult envelope", () => {
  it("parses a bare ok:true payload", () => {
    const parsed = ToolResultSchema.parse({ ok: true, data: { x: 1 } });
    expect(parsed.ok).toBe(true);
  });

  it("defaults error.retryable to false", () => {
    const parsed = ToolResultSchema.parse({
      ok: false,
      error: { code: "E_BUDGET", message: "over budget" },
    });
    expect(parsed.error?.retryable).toBe(false);
  });

  it("preserves retryable:true when provided", () => {
    const parsed = ToolResultSchema.parse({
      ok: false,
      error: { code: "E_TIMEOUT", message: "slow", retryable: true },
    });
    expect(parsed.error?.retryable).toBe(true);
  });
});

describe("PaperIdSchema union", () => {
  it("accepts a DOI string", () => {
    expect(PaperIdSchema.parse("10.1038/nature12373")).toBe(
      "10.1038/nature12373",
    );
  });

  it("accepts a 40-char S2 hex id", () => {
    const id = "abcdef0123456789abcdef0123456789abcdef01";
    expect(PaperIdSchema.parse(id)).toBe(id);
  });

  it("accepts an OpenAlex id", () => {
    expect(PaperIdSchema.parse("W2741809807")).toBe("W2741809807");
  });

  it("accepts a positive integer source_id", () => {
    expect(PaperIdSchema.parse(42)).toBe(42);
  });

  it("rejects empty string", () => {
    expect(() => PaperIdSchema.parse("")).toThrow();
  });

  it("rejects zero and negative integers (falls through to string branch, which fails on numeric input)", () => {
    expect(() => PaperIdSchema.parse(0)).toThrow();
    expect(() => PaperIdSchema.parse(-1)).toThrow();
  });
});

describe("papers_search", () => {
  it("defaults limit to 20", () => {
    const parsed = papers_search.args.parse({ query: "sleep" });
    expect(parsed.limit).toBe(20);
  });

  it("rejects empty query", () => {
    expect(() => papers_search.args.parse({ query: "" })).toThrow();
  });

  it("rejects limit > 100", () => {
    expect(() =>
      papers_search.args.parse({ query: "x", limit: 101 }),
    ).toThrow();
  });

  it("accepts year_from + venue filters", () => {
    const parsed = papers_search.args.parse({
      query: "attention",
      year_from: 2015,
      venue: "NeurIPS",
      min_citations: 10,
    });
    expect(parsed.year_from).toBe(2015);
    expect(parsed.venue).toBe("NeurIPS");
  });
});

describe("paper_get", () => {
  it("accepts any PaperId branch", () => {
    expect(paper_get.args.parse({ id: 7 }).id).toBe(7);
    expect(paper_get.args.parse({ id: "10.1038/x" }).id).toBe("10.1038/x");
    expect(paper_get.args.parse({ id: "W123" }).id).toBe("W123");
  });
});

describe("graph_neighborhood", () => {
  it("defaults kinds to [cites, cited_by]", () => {
    const parsed = graph_neighborhood.args.parse({ source_id: 1 });
    expect(parsed.kinds).toEqual(["cites", "cited_by"]);
    expect(parsed.limit).toBe(20);
  });

  it("rejects unknown kind", () => {
    expect(() =>
      graph_neighborhood.args.parse({
        source_id: 1,
        kinds: ["nope"],
      }),
    ).toThrow();
  });

  it("rejects non-positive source_id", () => {
    expect(() => graph_neighborhood.args.parse({ source_id: 0 })).toThrow();
  });
});

describe("graph_path", () => {
  it("defaults max_hops to 3", () => {
    const parsed = graph_path.args.parse({ from: 1, to: 2 });
    expect(parsed.max_hops).toBe(3);
  });

  it("rejects max_hops > 5", () => {
    expect(() =>
      graph_path.args.parse({ from: 1, to: 2, max_hops: 6 }),
    ).toThrow();
  });
});

describe("dive_spawn", () => {
  it("parses a valid spawn", () => {
    const parsed = dive_spawn.args.parse({
      seeds: ["10.1038/x"],
      focus: "balanced",
    });
    expect(parsed.seeds).toEqual(["10.1038/x"]);
    expect(parsed.budget_papers).toBe(60);
    expect(parsed.budget_seconds).toBe(180);
    expect(parsed.depth).toBe(2);
    expect(parsed.focus).toBe("balanced");
  });

  it("rejects empty seeds", () => {
    expect(() => dive_spawn.args.parse({ seeds: [] })).toThrow();
  });

  it("rejects > 20 seeds", () => {
    expect(() =>
      dive_spawn.args.parse({ seeds: Array.from({ length: 21 }, () => "x") }),
    ).toThrow();
  });

  it("rejects unknown focus", () => {
    expect(() =>
      dive_spawn.args.parse({ seeds: ["x"], focus: "sideways" }),
    ).toThrow();
  });

  it("result requires a uuid exploration_id", () => {
    const ok = dive_spawn.result.parse({
      exploration_id: UUID,
      status: "queued",
    });
    expect(ok.status).toBe("queued");

    expect(() =>
      dive_spawn.result.parse({
        exploration_id: "not-a-uuid",
        status: "queued",
      }),
    ).toThrow();
  });
});

describe("dive_status / dive_results", () => {
  it("dive_status requires uuid", () => {
    expect(() => dive_status.args.parse({ exploration_id: "nope" })).toThrow();
    expect(
      dive_status.args.parse({ exploration_id: UUID }).exploration_id,
    ).toBe(UUID);
  });

  it("dive_results defaults top_k to 25", () => {
    const parsed = dive_results.args.parse({ exploration_id: UUID });
    expect(parsed.top_k).toBe(25);
  });
});

describe("thread_memory_search / update / links_suggest", () => {
  it("thread_memory_search defaults scope to 'all'", () => {
    const parsed = thread_memory_search.args.parse({ query: "sleep stages" });
    expect(parsed.scope).toBe("all");
    expect(parsed.limit).toBe(10);
  });

  it("thread_memory_search rejects invalid scope", () => {
    expect(() =>
      thread_memory_search.args.parse({ query: "x", scope: "nope" }),
    ).toThrow();
  });

  it("thread_memory_update requires non-empty summary", () => {
    expect(() =>
      thread_memory_update.args.parse({
        thread_id: UUID,
        summary_md: "",
        topics: [],
      }),
    ).toThrow();
  });

  it("thread_memory_update returns { thread_id, updated_at }", () => {
    const parsed = thread_memory_update.result.parse({
      thread_id: UUID,
      updated_at: "2026-04-19T10:00:00Z",
    });
    expect(parsed.thread_id).toBe(UUID);
  });

  it("thread_links_suggest defaults limit to 10", () => {
    const parsed = thread_links_suggest.args.parse({ thread_id: UUID });
    expect(parsed.limit).toBe(10);
  });
});

describe("interest_* tools", () => {
  it("interest_register rejects empty query_terms", () => {
    expect(() =>
      interest_register.args.parse({
        label: "test",
        query_terms: [],
        cadence: "weekly",
      }),
    ).toThrow();
  });

  it("interest_register accepts minimal valid input", () => {
    const parsed = interest_register.args.parse({
      label: "sleep + CPAP",
      query_terms: ["sleep apnea", "CPAP adherence"],
      cadence: "weekly",
    });
    expect(parsed.cadence).toBe("weekly");
  });

  it("interest_register rejects unknown cadence", () => {
    expect(() =>
      interest_register.args.parse({
        label: "x",
        query_terms: ["y"],
        cadence: "hourly",
      }),
    ).toThrow();
  });

  it("interest_list accepts no args", () => {
    expect(() => interest_list.args.parse({})).not.toThrow();
  });

  it("interest_disable requires uuid", () => {
    expect(() => interest_disable.args.parse({ id: "not-uuid" })).toThrow();
    expect(interest_disable.args.parse({ id: UUID }).id).toBe(UUID);
  });
});

describe("inbox_list / inbox_triage", () => {
  it("inbox_list defaults limit to 50", () => {
    const parsed = inbox_list.args.parse({});
    expect(parsed.limit).toBe(50);
  });

  it("inbox_list accepts triage + since", () => {
    const parsed = inbox_list.args.parse({
      triage: "pending",
      since: "2026-04-01T00:00:00Z",
    });
    expect(parsed.triage).toBe("pending");
  });

  it("inbox_triage accepts save/dismiss/promote", () => {
    for (const action of ["save", "dismiss", "promote"] as const) {
      expect(inbox_triage.args.parse({ id: UUID, action }).action).toBe(action);
    }
  });

  it("inbox_triage rejects invalid uuid", () => {
    expect(() =>
      inbox_triage.args.parse({ id: "not-a-uuid", action: "save" }),
    ).toThrow();
  });

  it("inbox_triage rejects invalid action", () => {
    expect(() =>
      inbox_triage.args.parse({ id: UUID, action: "explode" }),
    ).toThrow();
  });
});

describe("kb_promote_request", () => {
  it("accepts valid slug", () => {
    const parsed = kb_promote_request.args.parse({
      source_ids: [1, 2, 3],
      kb_slug: "sleep/apnea",
      note_md: "## Why these\n\n- foo",
    });
    expect(parsed.kb_slug).toBe("sleep/apnea");
  });

  it("rejects uppercase or bad slug characters", () => {
    expect(() =>
      kb_promote_request.args.parse({
        source_ids: [1],
        kb_slug: "Sleep",
        note_md: "x",
      }),
    ).toThrow();
    expect(() =>
      kb_promote_request.args.parse({
        source_ids: [1],
        kb_slug: "sleep apnea",
        note_md: "x",
      }),
    ).toThrow();
  });

  it("rejects empty source_ids", () => {
    expect(() =>
      kb_promote_request.args.parse({
        source_ids: [],
        kb_slug: "x",
        note_md: "y",
      }),
    ).toThrow();
  });
});

describe("cp_open_url", () => {
  it("requires at least one source_id", () => {
    expect(() => cp_open_url.args.parse({ source_ids: [] })).toThrow();
  });

  it("accepts up to 20 source_ids", () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(cp_open_url.args.parse({ source_ids: ids }).source_ids).toHaveLength(
      20,
    );
  });

  it("rejects > 20 source_ids", () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(() => cp_open_url.args.parse({ source_ids: ids })).toThrow();
  });
});

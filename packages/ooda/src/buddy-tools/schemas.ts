// Zod schemas for every ACP-exposed buddy tool.
//
// These schemas are the contract between the agent and OODA. They validate
// every dispatch at runtime and, because Zod can emit JSON Schema, double as
// the source of truth the agent reads to learn what tools exist.
//
// Convention:
// - Tool names are snake_case (wire format, agent-facing).
// - Tool args keep snake_case keys (wire format).
// - Each tool exports `{ name, description, args, result }`.
// - `result` is a FLAT object describing the successful payload shape.
//   Errors are wrapped by the dispatcher in `ToolResult` (`{ok, data, error}`).

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Envelope every handler returns. The dispatcher wraps tool payloads into
 * this shape — `data` carries the tool-specific `result`, `error` carries a
 * structured failure with retry semantics.
 */
export const ToolResultSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().default(false),
    })
    .optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * Paper identifier union. The agent may pass:
 * - a DOI (e.g. "10.1038/nature12373")
 * - an S2 paper id (40-char hex)
 * - an OpenAlex work id (`W123456789`)
 * - a local `sources.id` (positive integer)
 * - or an opaque freetext id (fallback for future sources).
 *
 * Order matters: more specific regex branches come before the freetext
 * fallback so downstream handlers can dispatch on the matched shape.
 */
export const PaperIdSchema = z.union([
  z.string().regex(/^10\./, "looks like a DOI"),
  z.string().regex(/^[0-9a-f]{40}$/i, "S2 paper id hex"),
  z.string().regex(/^W\d+$/, "OpenAlex id starting with W"),
  z.number().int().positive(),
  z.string().min(1),
]);
export type PaperId = z.infer<typeof PaperIdSchema>;

/**
 * Shape of a paper row as surfaced by search/neighborhood tools. Kept in a
 * shared schema so `graph_neighborhood.result.papers` can reuse it without
 * duplicating fields.
 */
export const PaperSummarySchema = z.object({
  source_id: z.number().int(),
  s2_paper_id: z.string().nullable(),
  title: z.string(),
  abstract: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  citation_count: z.number().int().nullable(),
  doi: z.string().nullable(),
});
export type PaperSummary = z.infer<typeof PaperSummarySchema>;

// ---------------------------------------------------------------------------
// Graph navigation (sync, < 2s)
// ---------------------------------------------------------------------------

export const papers_search = {
  name: "papers_search",
  description:
    "Search academic papers by query. Returns up to `limit` papers with titles, abstracts, authors, and citation counts. Supports year and venue filters.",
  args: z.object({
    query: z.string().min(1),
    year_from: z.number().int().min(1900).max(2100).optional(),
    min_citations: z.number().int().min(0).optional(),
    venue: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  result: z.object({
    papers: z.array(PaperSummarySchema),
  }),
} as const;

export const paper_get = {
  name: "paper_get",
  description:
    "Fetch full metadata for one paper by DOI, S2 ID, OpenAlex ID, or local source_id. Returns tldr, abstract, citation counts, and OA PDF url when available.",
  args: z.object({ id: PaperIdSchema }),
  result: z.object({
    paper: z.object({
      // null if the paper isn't yet materialized in local `sources`
      source_id: z.number().int().nullable(),
      s2_paper_id: z.string().nullable(),
      doi: z.string().nullable(),
      title: z.string(),
      abstract: z.string().nullable(),
      tldr: z.string().nullable(),
      authors: z.array(z.string()),
      year: z.number().int().nullable(),
      venue: z.string().nullable(),
      citation_count: z.number().int().nullable(),
      influential_citation_count: z.number().int().nullable(),
      url: z.string().url().nullable(),
      oa_pdf_url: z.string().url().nullable(),
    }),
  }),
} as const;

export const GraphEdgeKindSchema = z.enum([
  "cites",
  "references",
  "similar_embedding",
  "recommended_by_s2",
]);
export type GraphEdgeKind = z.infer<typeof GraphEdgeKindSchema>;

export const graph_neighborhood = {
  name: "graph_neighborhood",
  description:
    "One-hop neighbors of a paper via outbound citations, inbound citations, embedding-similar, or S2 recommendations. Returns both edges and the hydrated paper summaries for the neighbors.",
  args: z.object({
    source_id: z.number().int().positive(),
    kinds: z
      .array(z.enum(["cites", "cited_by", "similar", "recommended"]))
      .default(["cites", "cited_by"]),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  result: z.object({
    edges: z.array(
      z.object({
        from_source_id: z.number().int(),
        to_source_id: z.number().int(),
        kind: GraphEdgeKindSchema,
        weight: z.number().nullable(),
      }),
    ),
    papers: z.array(PaperSummarySchema),
  }),
} as const;

export const graph_path = {
  name: "graph_path",
  description:
    "Shortest citation path between two papers, bounded by max_hops (default 3). Returns empty path if no route exists within the bound.",
  args: z.object({
    from: z.number().int(),
    to: z.number().int(),
    max_hops: z.number().int().min(1).max(5).default(3),
  }),
  result: z.object({
    path: z.array(
      z.object({
        from_source_id: z.number().int(),
        to_source_id: z.number().int(),
        kind: z.string(),
      }),
    ),
    hops: z.number().int(),
  }),
} as const;

// ---------------------------------------------------------------------------
// Dive orchestration (async)
// ---------------------------------------------------------------------------

export const DiveStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "error",
  "cancelled",
]);
export type DiveStatus = z.infer<typeof DiveStatusSchema>;

export const dive_spawn = {
  name: "dive_spawn",
  description:
    "Start a bounded autonomous dive from seed papers or queries. Returns immediately with an exploration_id; use dive_status to poll and dive_results to collect the ranked findings when done.",
  args: z.object({
    seeds: z.array(z.string()).min(1).max(20),
    depth: z.number().int().min(1).max(4).default(2),
    budget_papers: z.number().int().min(5).max(300).default(60),
    budget_seconds: z.number().int().min(30).max(900).default(180),
    focus: z.enum(["balanced", "recent", "foundational"]).default("balanced"),
  }),
  result: z.object({
    exploration_id: z.string().uuid(),
    status: z.literal("queued"),
  }),
} as const;

export const dive_status = {
  name: "dive_status",
  description:
    "Poll the state of a dive started via dive_spawn. Returns the current phase, progress counters, and an ETA in seconds when running.",
  args: z.object({
    exploration_id: z.string().uuid(),
  }),
  result: z.object({
    exploration_id: z.string().uuid(),
    status: DiveStatusSchema,
    papers_visited: z.number().int().min(0),
    papers_scored: z.number().int().min(0),
    budget_papers: z.number().int(),
    budget_seconds: z.number().int(),
    elapsed_seconds: z.number().min(0),
    eta_seconds: z.number().min(0).nullable(),
    error: z.string().nullable(),
  }),
} as const;

export const dive_results = {
  name: "dive_results",
  description:
    "Fetch the top-k ranked findings from a completed dive. Each finding includes the paper, relevance score, and a 1-2 sentence rationale explaining why it surfaced.",
  args: z.object({
    exploration_id: z.string().uuid(),
    top_k: z.number().int().min(1).max(200).default(25),
  }),
  result: z.object({
    exploration_id: z.string().uuid(),
    findings: z.array(
      z.object({
        source_id: z.number().int(),
        paper: PaperSummarySchema,
        score: z.number(),
        rationale: z.string().nullable(),
      }),
    ),
  }),
} as const;

// ---------------------------------------------------------------------------
// Memory & cross-thread
// ---------------------------------------------------------------------------

export const ThreadMemoryScopeSchema = z.enum([
  "this",
  "all",
  "research_vault",
]);
export type ThreadMemoryScope = z.infer<typeof ThreadMemoryScopeSchema>;

export const thread_memory_search = {
  name: "thread_memory_search",
  description:
    "Semantic search across thread memories. Scope controls which threads are searched: `this` (current thread only), `all` (every thread for the user), or `research_vault` (promoted KB memories).",
  args: z.object({
    query: z.string().min(1),
    scope: ThreadMemoryScopeSchema.default("all"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  result: z.object({
    threads: z.array(
      z.object({
        thread_id: z.string().uuid(),
        title: z.string().nullable(),
        rolling_summary_md: z.string(),
        topics: z.array(z.string()),
        score: z.number(),
        updated_at: z.string(), // ISO8601
      }),
    ),
  }),
} as const;

export const thread_memory_update = {
  name: "thread_memory_update",
  description:
    "Overwrite the rolling summary and topic list for a thread. Called by the agent at turn end to keep thread_memory fresh for the nightly synergy-mining loop.",
  args: z.object({
    thread_id: z.string().uuid(),
    summary_md: z.string().min(1),
    topics: z.array(z.string()).max(64),
  }),
  result: z.object({
    thread_id: z.string().uuid(),
    updated_at: z.string(), // ISO8601
  }),
} as const;

export const thread_links_suggest = {
  name: "thread_links_suggest",
  description:
    "Surface other threads whose topic_fingerprint, shared citations, or open questions overlap with the given thread. Returns ranked synergies with human-readable reasons.",
  args: z.object({
    thread_id: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  result: z.object({
    links: z.array(
      z.object({
        to_thread_id: z.string().uuid(),
        to_thread_title: z.string().nullable(),
        kind: z.enum([
          "topic_overlap",
          "citation_overlap",
          "question_answered",
        ]),
        score: z.number(),
        reason_md: z.string().nullable(),
      }),
    ),
  }),
} as const;

// ---------------------------------------------------------------------------
// Standing interests
// ---------------------------------------------------------------------------

export const InterestCadenceSchema = z.enum(["daily", "weekly", "monthly"]);
export type InterestCadence = z.infer<typeof InterestCadenceSchema>;

export const interest_register = {
  name: "interest_register",
  description:
    "Register a standing interest that schedules recurring searches. Future findings land in findings_inbox for triage.",
  args: z.object({
    label: z.string().min(1).max(200),
    query_terms: z.array(z.string().min(1)).min(1).max(20),
    seed_source_ids: z.array(z.number().int().positive()).max(50).optional(),
    cadence: InterestCadenceSchema,
    thread_id: z.string().uuid().optional(),
  }),
  result: z.object({
    id: z.string().uuid(),
    cadence: InterestCadenceSchema,
    next_run_at: z.string(), // ISO8601
  }),
} as const;

export const interest_list = {
  name: "interest_list",
  description:
    "List standing interests. If thread_id is provided, only interests scoped to that thread are returned; otherwise all interests for the user.",
  args: z.object({
    thread_id: z.string().uuid().optional(),
  }),
  result: z.object({
    interests: z.array(
      z.object({
        id: z.string().uuid(),
        label: z.string(),
        query_terms: z.array(z.string()),
        cadence: InterestCadenceSchema,
        enabled: z.boolean(),
        last_run_at: z.string().nullable(), // ISO8601
        next_run_at: z.string().nullable(), // ISO8601
        thread_id: z.string().uuid().nullable(),
      }),
    ),
  }),
} as const;

export const interest_disable = {
  name: "interest_disable",
  description:
    "Disable a standing interest. Prevents future scheduled runs; does not delete existing findings.",
  args: z.object({
    id: z.string().uuid(),
  }),
  result: z.object({
    id: z.string().uuid(),
    disabled_at: z.string(), // ISO8601
  }),
} as const;

export const InboxTriageStateSchema = z.enum([
  "pending",
  "saved",
  "dismissed",
  "promoted",
]);
export type InboxTriageState = z.infer<typeof InboxTriageStateSchema>;

export const inbox_list = {
  name: "inbox_list",
  description:
    "List findings_inbox entries. Filter by triage state and by `since` (ISO8601 timestamp). Ordered by found_at desc.",
  args: z.object({
    triage: InboxTriageStateSchema.optional(),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  result: z.object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        source_id: z.number().int().nullable(),
        paper: PaperSummarySchema.nullable(),
        standing_interest_id: z.string().uuid().nullable(),
        thread_id: z.string().uuid().nullable(),
        found_at: z.string(), // ISO8601
        triage: InboxTriageStateSchema,
        reason_md: z.string().nullable(),
      }),
    ),
  }),
} as const;

export const inbox_triage = {
  name: "inbox_triage",
  description:
    "Triage a findings_inbox entry. `save` keeps it for later, `dismiss` hides it, `promote` flags it for a kb_promote_request draft.",
  args: z.object({
    id: z.string().uuid(),
    action: z.enum(["save", "dismiss", "promote"]),
  }),
  result: z.object({
    id: z.string().uuid(),
    triage: InboxTriageStateSchema,
  }),
} as const;

// ---------------------------------------------------------------------------
// KB promotion (human-in-the-loop — never auto-commits in V1.5)
// ---------------------------------------------------------------------------

export const kb_promote_request = {
  name: "kb_promote_request",
  description:
    "Draft a PR-style diff promoting source_ids into a KB slug with a markdown note. Surfaces in the dashboard for human approval. Never auto-commits.",
  args: z.object({
    source_ids: z.array(z.number().int().positive()).min(1).max(50),
    kb_slug: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9\-/]*$/, "kb slug: lowercase, hyphens, slashes"),
    note_md: z.string().max(20000),
  }),
  result: z.object({
    promotion_id: z.string().uuid(),
    kb_slug: z.string(),
    dashboard_url: z.string().url(),
    source_ids: z.array(z.number().int()),
  }),
} as const;

// ---------------------------------------------------------------------------
// CP handoff
// ---------------------------------------------------------------------------

export const cp_open_url = {
  name: "cp_open_url",
  description:
    "Return Connected Papers URLs for one or more local source_ids. Format: https://www.connectedpapers.com/main/{s2_id}. Handoff for visual exploration.",
  args: z.object({
    source_ids: z.array(z.number().int().positive()).min(1).max(20),
  }),
  result: z.object({
    urls: z.array(
      z.object({
        source_id: z.number().int(),
        s2_paper_id: z.string().nullable(),
        url: z.string().url().nullable(),
      }),
    ),
  }),
} as const;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// Tools with real backing (tRPC procedures exist; the handler resolves).
// This is what agents should see in their tool surface today.
export const TOOLS_IMPLEMENTED = {
  dive_spawn,
  dive_status,
  dive_results,
  papers_search,
  paper_get,
  graph_neighborhood,
  graph_path,
  thread_memory_search,
  thread_memory_update,
  thread_links_suggest,
  interest_register,
  interest_list,
  interest_disable,
  inbox_list,
  inbox_triage,
  kb_promote_request,
  cp_open_url,
} as const;

// Tools whose schemas exist but the handler throws NOT_IMPLEMENTED because
// the backing tRPC procedure hasn't landed yet. Empty in V1.5 now that
// the original six planned tools all have real backing. Re-populate if a
// future agent-facing schema lands before its server-side wire-up.
export const TOOLS_PLANNED = {} as const;

// Main registry used by the dispatcher. Equal to `TOOLS_IMPLEMENTED` today.
// Kept as its own symbol so a future `BUDDY_EXPOSE_PLANNED_TOOLS=1` env
// toggle (for agent eval harnesses that want to test the stubbed schema
// shapes) can widen it to `{ ...TOOLS_IMPLEMENTED, ...TOOLS_PLANNED }`
// without a broader refactor.
export const TOOLS = TOOLS_IMPLEMENTED;

export type ToolName = keyof typeof TOOLS;
// Names present anywhere in the registry — used by the handlers index
// and tests so we can still reference planned-tool schemas directly
// without exposing them via `TOOLS`.
export type AnyToolName =
  | keyof typeof TOOLS_IMPLEMENTED
  | keyof typeof TOOLS_PLANNED;

export type ToolArgs<T extends ToolName> = z.infer<(typeof TOOLS)[T]["args"]>;
export type ToolResultPayload<T extends ToolName> = z.infer<
  (typeof TOOLS)[T]["result"]
>;

/** All tool names as an array — handy for enumerating in tests / dispatcher init. */
export const TOOL_NAMES = Object.keys(TOOLS) as readonly ToolName[];

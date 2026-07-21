# Planner ↔ Oracle Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Bob's server-side planner query OODA's oracle at plan-generation time, via a deterministic seed injection plus a live MCP tool, gated entirely behind env vars (off = today's behavior).

**Architecture:** Two channels into the same `oracle.query` tRPC procedure. **Channel A (seed):** the execution daemon (`apps/bob-execution`) runs one oracle query from the planning intent and injects ranked chunks into the prompt before spawning `claude`. **Channel B (live tool):** the daemon attaches a stdio MCP server (`ooda-oracle`) via `--mcp-config`, exposing `oracle_query` to the planner. Opt-in for Channel B is the presence of `mcp__ooda__oracle_query` in the persona's `allowed_tools`.

**Tech Stack:** TypeScript/Node, `@trpc/client` + `superjson` (oracle HTTP client), `@modelcontextprotocol/sdk` (MCP stdio server), Vitest. Daemon runs via `tsx` on hetzner-bob (no build step).

**Design doc:** `docs/plans/2026-06-17-planner-oracle-bridge-design.md`

**Key existing code:**
- `apps/bob-execution/src/daemon/index.ts` — `buildPrompt()` (line 283), prompt built at line 238, `runAgent()` (382), `getAgentCommand()` (605), `PersonaConfig` (562), `getPersonaConfig()` (569).
- `packages/ooda/src/api/router/oracle.ts` — `oracle.query` (`.query`, Bearer `OODA_ORACLE_TOKEN`).
- `packages/ooda/src/oracle/query.ts:15-39` — `OracleQueryInput` / `OracleChunk` / `OracleQueryResult` types.
- `apps/ooda-runner/src/trpc-client.ts` — tRPC-to-OODA client pattern to mirror.
- `apps/mobile-bob/src/features/chat/hooks/use-oracle-search.ts` — hand-typed `createTRPCClient<AnyRouter>` pattern (no AppRouter import).
- `docs/personas/planner.yaml` — planner persona; `allowed_tools` flows to daemon via `packages/bob/src/api/src/handlers/planSession.ts:235-239`.

**Conventions:** All daemon log lines use the `[oracle]` prefix. Oracle is never on the critical path — every failure path injects/returns nothing and continues.

---

## Task 0: Recon & dependencies

**Goal:** Confirm runtime assumptions and add deps before writing code. No TDD (investigation + package.json edit).

**Step 1: Verify the planner persona's `allowed_tools` reaches the daemon at runtime.**

The opt-in depends on `mcp__ooda__oracle_query` appearing in `session.personaConfig.allowedTools`. Confirm where `plannerPersona` is loaded (DB seed vs. yaml file) in `packages/bob/src/api/src/handlers/planSession.ts` around line 223-239.

Run:
```bash
grep -n "plannerPersona\|getPersonaBySlug\|personas\b\|allowed_tools\|allowedTools" packages/bob/src/api/src/handlers/planSession.ts
```
- If the persona is read straight from `docs/personas/planner.yaml`, editing the yaml (Task 5) is sufficient.
- If it is seeded into a DB table, note the seed path — Task 5 must reseed. Record the finding in a scratch comment in the plan PR description.

**Step 2: Confirm the OODA API base URL reachable from the daemon.**

Run:
```bash
grep -rn "OODA_API_URL\|OODA_SERVER_URL\|serverUrl\|OODA_RUNNER" apps/ooda-runner/src | head
```
Record the env var name the runner already uses for OODA's base URL. We will reuse the same host value for `OODA_API_URL` (the oracle lives at `${OODA_API_URL}/api/trpc`).

**Step 3: Add dependencies to `apps/bob-execution`.**

Modify `apps/bob-execution/package.json` — add to `dependencies`:
```json
"@modelcontextprotocol/sdk": "^1.0.0",
"@trpc/client": "catalog:",
"superjson": "catalog:",
"zod": "catalog:"
```
(Use `catalog:` only if those names exist in the workspace catalog; otherwise pin the versions used by `apps/ooda-runner` — check with `grep -n "@trpc/client\|superjson\|zod" apps/ooda-runner/package.json`. Match `@modelcontextprotocol/sdk` to whatever is current; `^1` is the floor.)

**Step 4: Install.**

Run: `pnpm install`
Expected: lockfile updates, no errors.

**Step 5: Commit.**
```bash
git add apps/bob-execution/package.json pnpm-lock.yaml
git commit -m "chore(bob-execution): add oracle bridge deps (trpc-client, superjson, mcp-sdk)"
```

---

## Task 1: Oracle client + pure helpers

**Files:**
- Create: `apps/bob-execution/src/oracle-client.ts`
- Test: `apps/bob-execution/src/oracle-client.test.ts`

This module holds the thin tRPC client plus two **pure** helpers that are the real TDD targets (`buildSeedQuestion`, `formatOracleSection`). The network client is a thin wrapper, integration-tested on the box.

**Step 1: Write the failing test.**

`apps/bob-execution/src/oracle-client.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildSeedQuestion, formatOracleSection, type OracleQueryResult } from "./oracle-client";

describe("buildSeedQuestion", () => {
  it("combines intent and notes", () => {
    expect(buildSeedQuestion("add auth", "use better-auth")).toBe("add auth\n\nuse better-auth");
  });
  it("uses intent alone when notes absent", () => {
    expect(buildSeedQuestion("add auth", undefined)).toBe("add auth");
  });
  it("returns empty string when nothing provided", () => {
    expect(buildSeedQuestion(undefined, undefined)).toBe("");
  });
});

describe("formatOracleSection", () => {
  const base: OracleQueryResult = { chunks: [], confidence: 0, queryId: "q1", latencyMs: 5 };

  it("returns empty string when there are no chunks", () => {
    expect(formatOracleSection(base)).toBe("");
  });

  it("renders a numbered knowledge section with titles and confidence", () => {
    const result: OracleQueryResult = {
      ...base,
      confidence: 0.82,
      chunks: [
        { unitId: "u1", sourceId: 1, content: "Use Drizzle for migrations.", tokenCount: 6,
          headingContext: null, score: 0.9, sourceTitle: "DB Guide", sourceUrl: null,
          sourceKind: "doc", contentAsOf: null },
      ],
    };
    const section = formatOracleSection(result);
    expect(section).toContain("## Knowledge from OODA (oracle, confidence 0.82)");
    expect(section).toContain("1. [DB Guide] Use Drizzle for migrations.");
    expect(section).toContain("oracle_query tool");
  });

  it("falls back to 'untitled source' when sourceTitle is null", () => {
    const result: OracleQueryResult = {
      ...base, confidence: 0.5,
      chunks: [{ unitId: "u1", sourceId: 1, content: "x", tokenCount: 1, headingContext: null,
        score: 0.5, sourceTitle: null, sourceUrl: null, sourceKind: "doc", contentAsOf: null }],
    };
    expect(formatOracleSection(result)).toContain("[untitled source] x");
  });
});
```

**Step 2: Run test to verify it fails.**

Run: `cd apps/bob-execution && pnpm exec vitest run src/oracle-client.test.ts`
Expected: FAIL — module/exports not found.

**Step 3: Write the implementation.**

`apps/bob-execution/src/oracle-client.ts`:
```ts
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import SuperJSON from "superjson";

export interface OracleChunk {
  unitId: string;
  sourceId: number;
  content: string;
  tokenCount: number;
  headingContext: string | null;
  score: number;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceKind: string;
  contentAsOf: string | Date | null;
}

export interface OracleQueryResult {
  chunks: OracleChunk[];
  confidence: number;
  queryId: string;
  latencyMs: number;
}

export interface OracleQueryInput {
  task: string;
  repo?: string;
  question: string;
  topK?: number;
}

export interface OracleClient {
  oracle: { query: { query: (input: OracleQueryInput) => Promise<OracleQueryResult> } };
}

/** Thin tRPC client to OODA's oracle.query. Hand-typed so we don't import OODA's AppRouter. */
export function createOracleClient(baseUrl: string, token: string): OracleClient {
  const client = createTRPCClient<AnyRouter>({
    links: [
      httpBatchLink({
        transformer: SuperJSON,
        url: `${baseUrl.replace(/\/$/, "")}/api/trpc`,
        headers() {
          return { "x-trpc-source": "bob-executor", authorization: `Bearer ${token}` };
        },
      }),
    ],
  });
  return client as unknown as OracleClient;
}

/** Combine planning intent and notes into a single oracle question. */
export function buildSeedQuestion(intent?: string, notes?: string): string {
  return [intent, notes].filter((s) => s && s.trim()).join("\n\n").trim();
}

/** Render oracle chunks as a prompt section. Returns "" when there are no chunks. */
export function formatOracleSection(result: OracleQueryResult): string {
  if (!result.chunks.length) return "";
  const lines = result.chunks.map((c, i) => {
    const title = c.sourceTitle?.trim() || "untitled source";
    const content = c.content.trim().replace(/\s+/g, " ");
    return `${i + 1}. [${title}] ${content}`;
  });
  return [
    `## Knowledge from OODA (oracle, confidence ${result.confidence.toFixed(2)})`,
    ...lines,
    `_Use the oracle_query tool to dig deeper into any of these._`,
  ].join("\n");
}
```

**Step 4: Run test to verify it passes.**

Run: `cd apps/bob-execution && pnpm exec vitest run src/oracle-client.test.ts`
Expected: PASS (all cases).

**Step 5: Commit.**
```bash
git add apps/bob-execution/src/oracle-client.ts apps/bob-execution/src/oracle-client.test.ts
git commit -m "feat(bob-execution): oracle tRPC client + seed/format helpers"
```

---

## Task 2: Seed fetch orchestrator (Channel A logic)

**Files:**
- Modify: `apps/bob-execution/src/oracle-client.ts` (add `fetchOracleSeed`)
- Test: `apps/bob-execution/src/oracle-client.test.ts` (extend)

`fetchOracleSeed` takes the client by parameter (dependency injection) so it is unit-testable with a stub — no network. It applies a timeout and swallows all errors, returning `""`.

**Step 1: Write the failing test (append to existing test file).**

```ts
import { fetchOracleSeed } from "./oracle-client";

describe("fetchOracleSeed", () => {
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const okResult: OracleQueryResult = {
    confidence: 0.7, queryId: "qid", latencyMs: 12,
    chunks: [{ unitId: "u", sourceId: 1, content: "hi", tokenCount: 1, headingContext: null,
      score: 0.7, sourceTitle: "S", sourceUrl: null, sourceKind: "doc", contentAsOf: null }],
  };

  it("returns a formatted section and logs queryId on success", async () => {
    const client = { oracle: { query: { query: async () => okResult } } };
    const section = await fetchOracleSeed(client, { question: "q", topK: 6 }, log);
    expect(section).toContain("## Knowledge from OODA");
    expect(logs.some((l) => l.includes("qid"))).toBe(true);
  });

  it("returns empty string and never throws when the client rejects", async () => {
    const client = { oracle: { query: { query: async () => { throw new Error("boom"); } } } };
    const section = await fetchOracleSeed(client, { question: "q" }, log);
    expect(section).toBe("");
  });

  it("returns empty string when the question is blank", async () => {
    let called = false;
    const client = { oracle: { query: { query: async () => { called = true; return okResult; } } } };
    const section = await fetchOracleSeed(client, { question: "   " }, log);
    expect(section).toBe("");
    expect(called).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails.**

Run: `cd apps/bob-execution && pnpm exec vitest run src/oracle-client.test.ts`
Expected: FAIL — `fetchOracleSeed` not exported.

**Step 3: Implement (append to `oracle-client.ts`).**

```ts
const DEFAULT_TOPK = 6;
const DEFAULT_TIMEOUT_MS = 3_000;

export async function fetchOracleSeed(
  client: OracleClient,
  params: { question: string; repo?: string; topK?: number; timeoutMs?: number },
  log: (msg: string) => void,
): Promise<string> {
  const question = params.question.trim();
  if (!question) return "";
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const result = await Promise.race([
      client.oracle.query.query({
        task: "bob planning",
        repo: params.repo,
        question,
        topK: params.topK ?? DEFAULT_TOPK,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`oracle timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    const section = formatOracleSection(result);
    if (!section) {
      log(`[oracle] seed query skipped: 0 chunks (queryId ${result.queryId})`);
      return "";
    }
    log(`[oracle] seed: ${result.chunks.length} chunks, confidence ${result.confidence.toFixed(2)}, queryId ${result.queryId}, ${result.latencyMs}ms`);
    return section;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[oracle] seed query skipped: ${msg}`);
    return "";
  }
}
```

**Step 4: Run test to verify it passes.**

Run: `cd apps/bob-execution && pnpm exec vitest run src/oracle-client.test.ts`
Expected: PASS.

**Step 5: Commit.**
```bash
git add apps/bob-execution/src/oracle-client.ts apps/bob-execution/src/oracle-client.test.ts
git commit -m "feat(bob-execution): fetchOracleSeed with timeout + non-blocking errors"
```

---

## Task 3: Oracle config gate

**Files:**
- Create: `apps/bob-execution/src/oracle-config.ts`
- Test: `apps/bob-execution/src/oracle-config.test.ts`

Centralize the env gate so both the daemon and the MCP server read it the same way.

**Step 1: Write the failing test.**
```ts
import { describe, expect, it } from "vitest";
import { readOracleConfig } from "./oracle-config";

describe("readOracleConfig", () => {
  it("is disabled when either var is missing", () => {
    expect(readOracleConfig({ OODA_API_URL: "https://x" }).enabled).toBe(false);
    expect(readOracleConfig({ OODA_ORACLE_TOKEN: "t" }).enabled).toBe(false);
    expect(readOracleConfig({}).enabled).toBe(false);
  });
  it("is enabled and carries values when both vars are present", () => {
    const cfg = readOracleConfig({ OODA_API_URL: "https://x", OODA_ORACLE_TOKEN: "t" });
    expect(cfg).toEqual({ enabled: true, apiUrl: "https://x", token: "t" });
  });
});
```

**Step 2: Run test to verify it fails.**
Run: `cd apps/bob-execution && pnpm exec vitest run src/oracle-config.test.ts`
Expected: FAIL.

**Step 3: Implement.**
`apps/bob-execution/src/oracle-config.ts`:
```ts
export interface OracleConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
}

export function readOracleConfig(env: Record<string, string | undefined> = process.env): OracleConfig {
  const apiUrl = env.OODA_API_URL ?? "";
  const token = env.OODA_ORACLE_TOKEN ?? "";
  return { enabled: Boolean(apiUrl && token), apiUrl, token };
}
```

**Step 4: Run test to verify it passes.**
Run: `cd apps/bob-execution && pnpm exec vitest run src/oracle-config.test.ts`
Expected: PASS.

**Step 5: Commit.**
```bash
git add apps/bob-execution/src/oracle-config.ts apps/bob-execution/src/oracle-config.test.ts
git commit -m "feat(bob-execution): oracle env config gate"
```

---

## Task 4: Wire seed injection into the daemon (Channel A)

**Files:**
- Modify: `apps/bob-execution/src/daemon/index.ts` (around line 238, where `const prompt = buildPrompt(session)` is)

No new unit test here (the logic is covered by Task 1-2; this is wiring inside the live daemon flow, verified on the box in Task 8). Keep the change minimal.

**Step 1: Add imports at the top of `daemon/index.ts`.**
```ts
import { createOracleClient, fetchOracleSeed, buildSeedQuestion } from "../oracle-client";
import { readOracleConfig } from "../oracle-config";
```
(Adjust the relative path: `daemon/index.ts` → `../oracle-client`.)

**Step 2: Add a module-level singleton client near the config block (after the `Config` section).**
```ts
const ORACLE = readOracleConfig();
const oracleClient = ORACLE.enabled ? createOracleClient(ORACLE.apiUrl, ORACLE.token) : null;
```

**Step 3: Inject the seed at the prompt-build site (line ~238).**

Find:
```ts
  const prompt = buildPrompt(session);
```
Replace with:
```ts
  let prompt = buildPrompt(session);
  if (oracleClient && session.sessionType === "planning") {
    const lc = session.planningContext?.launchContext;
    const question = buildSeedQuestion(lc?.intent, lc?.notes);
    const section = await fetchOracleSeed(
      oracleClient,
      { question, repo: session.branch ?? undefined },
      (m) => console.log(m),
    );
    if (section) prompt = `${prompt}\n\n${section}`;
  }
```
(Confirm this site is inside an `async` function — it is: line 238 sits in the async session handler that later `await runAgent(...)`. If TS complains about `await`, the enclosing function already returns a promise; no signature change needed.)

**Step 4: Typecheck.**
Run: `cd apps/bob-execution && pnpm exec tsc --noEmit`
Expected: no errors. (If `session.planningContext.launchContext` typing is `unknown`, mirror the existing access pattern used in `buildPrompt` — it already reads `pc.launchContext.intent`/`.notes`.)

**Step 5: Commit.**
```bash
git add apps/bob-execution/src/daemon/index.ts
git commit -m "feat(bob-execution): seed planner prompt with OODA oracle knowledge (Channel A)"
```

---

## Task 5: MCP server (Channel B server)

**Files:**
- Create: `apps/bob-execution/src/ooda-oracle-mcp.ts`
- Test: `apps/bob-execution/src/ooda-oracle-mcp.test.ts` (tests the pure result→text formatter; the stdio wiring is integration-tested on the box)

Factor the tool's text rendering into a pure, testable function; keep the transport thin.

**Step 1: Write the failing test.**
```ts
import { describe, expect, it } from "vitest";
import { renderToolText } from "./ooda-oracle-mcp";
import type { OracleQueryResult } from "./oracle-client";

const result: OracleQueryResult = {
  confidence: 0.6, queryId: "q", latencyMs: 9,
  chunks: [{ unitId: "u", sourceId: 1, content: "alpha", tokenCount: 1, headingContext: null,
    score: 0.6, sourceTitle: "Src", sourceUrl: "http://x", sourceKind: "doc", contentAsOf: null }],
};

describe("renderToolText", () => {
  it("lists chunks with source titles and confidence", () => {
    const text = renderToolText(result);
    expect(text).toContain("confidence 0.60");
    expect(text).toContain("[Src] alpha");
  });
  it("reports no results clearly when chunks are empty", () => {
    expect(renderToolText({ ...result, chunks: [] })).toContain("No knowledge found");
  });
});
```

**Step 2: Run test to verify it fails.**
Run: `cd apps/bob-execution && pnpm exec vitest run src/ooda-oracle-mcp.test.ts`
Expected: FAIL.

**Step 3: Implement the MCP server.**
`apps/bob-execution/src/ooda-oracle-mcp.ts`:
```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createOracleClient, type OracleQueryResult } from "./oracle-client";
import { readOracleConfig } from "./oracle-config";

export function renderToolText(result: OracleQueryResult): string {
  if (!result.chunks.length) return "No knowledge found in the OODA oracle for that query.";
  const lines = result.chunks.map((c, i) => {
    const title = c.sourceTitle?.trim() || "untitled source";
    return `${i + 1}. [${title}] ${c.content.trim().replace(/\s+/g, " ")}`;
  });
  return [`Oracle results (confidence ${result.confidence.toFixed(2)}):`, ...lines].join("\n");
}

async function main(): Promise<void> {
  const cfg = readOracleConfig();
  if (!cfg.enabled) {
    console.error("[ooda-oracle-mcp] OODA_API_URL / OODA_ORACLE_TOKEN not set; exiting.");
    process.exit(0);
  }
  const client = createOracleClient(cfg.apiUrl, cfg.token);
  const server = new McpServer({ name: "ooda-oracle", version: "0.1.0" });

  server.tool(
    "oracle_query",
    "Query the OODA knowledge base (oracle) for documented patterns, prior decisions, and domain knowledge.",
    {
      question: z.string().min(1).describe("The natural-language question to ask the knowledge base."),
      topK: z.number().int().min(1).max(20).optional().describe("Max results (default 6)."),
      repo: z.string().optional().describe("Optional repo context to bias retrieval."),
    },
    async ({ question, topK, repo }) => {
      try {
        const result = await client.oracle.query.query({
          task: "bob planning (live)", question, topK: topK ?? 6, repo,
        });
        return { content: [{ type: "text", text: renderToolText(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Oracle query failed: ${msg}` }], isError: true };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

// Only run the server when executed directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("ooda-oracle-mcp.ts")) {
  void main();
}
```
> Note: confirm the `McpServer.tool(...)` signature against the installed `@modelcontextprotocol/sdk` version (the high-level `tool(name, description, zodShape, handler)` API). If the installed major differs, adapt to its server API — the pure `renderToolText` test stays valid regardless.

**Step 4: Run test to verify it passes.**
Run: `cd apps/bob-execution && pnpm exec vitest run src/ooda-oracle-mcp.test.ts`
Expected: PASS.

**Step 5: Commit.**
```bash
git add apps/bob-execution/src/ooda-oracle-mcp.ts apps/bob-execution/src/ooda-oracle-mcp.test.ts
git commit -m "feat(bob-execution): ooda-oracle MCP stdio server (Channel B)"
```

---

## Task 6: Attach the MCP server in the daemon (Channel B wiring)

**Files:**
- Modify: `apps/bob-execution/src/daemon/index.ts` — `getAgentCommand()` (line 605) + a startup helper that writes the MCP config file.
- Test: `apps/bob-execution/src/daemon/get-agent-command.test.ts`

`getAgentCommand` currently takes `(agentType, prompt, persona)`. We add an optional `oracleMcpConfigPath` and, when present **and** the persona opts in (`mcp__ooda__oracle_query` in `allowedTools`), push `--mcp-config <path>` and ensure the tool is in `--allowedTools`.

**Step 1: Extract a testable variant.** To unit-test without refactoring the big function, export a small pure helper. Add to `daemon/index.ts` (exported):
```ts
export function claudeOracleArgs(
  persona: { allowedTools?: string[] } | undefined,
  mcpConfigPath: string | null,
): { mcpArgs: string[]; toolsToAdd: string[] } {
  const wantsOracle = Boolean(persona?.allowedTools?.includes("mcp__ooda__oracle_query"));
  if (!wantsOracle || !mcpConfigPath) return { mcpArgs: [], toolsToAdd: [] };
  return { mcpArgs: ["--mcp-config", mcpConfigPath], toolsToAdd: ["mcp__ooda__oracle_query"] };
}
```

**Step 2: Write the failing test.**
`apps/bob-execution/src/daemon/get-agent-command.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { claudeOracleArgs } from "./index";

describe("claudeOracleArgs", () => {
  it("returns nothing when persona does not declare the oracle tool", () => {
    expect(claudeOracleArgs({ allowedTools: ["Read"] }, "/tmp/mcp.json"))
      .toEqual({ mcpArgs: [], toolsToAdd: [] });
  });
  it("returns nothing when there is no mcp config path", () => {
    expect(claudeOracleArgs({ allowedTools: ["mcp__ooda__oracle_query"] }, null))
      .toEqual({ mcpArgs: [], toolsToAdd: [] });
  });
  it("returns mcp-config args and the tool when both opt-in and path are present", () => {
    expect(claudeOracleArgs({ allowedTools: ["mcp__ooda__oracle_query"] }, "/tmp/mcp.json"))
      .toEqual({ mcpArgs: ["--mcp-config", "/tmp/mcp.json"], toolsToAdd: ["mcp__ooda__oracle_query"] });
  });
});
```
> If importing from `./index` triggers daemon side-effects (it calls `process.exit` when `BOB_API_KEY` is unset), set the required env in the test file's top: `process.env.BOB_API_KEY ||= "test"; process.env.BOB_WORKSPACE_ID ||= "test";` **before** the import, or move `claudeOracleArgs` into a separate `daemon/oracle-args.ts` module and import from there (preferred — avoids the side-effect entirely). Choose the separate-module approach if the env shim is fragile.

**Step 3: Run test to verify it fails.**
Run: `cd apps/bob-execution && pnpm exec vitest run src/daemon/get-agent-command.test.ts`
Expected: FAIL.

**Step 4: Implement.**

a. Add a startup helper + module path resolution near the config block of `daemon/index.ts`:
```ts
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

function setupOracleMcpConfig(): string | null {
  if (!ORACLE.enabled) return null;
  const mcpServerPath = fileURLToPath(new URL("../ooda-oracle-mcp.ts", import.meta.url));
  const configPath = join(tmpdir(), `ooda-oracle-mcp.${process.pid}.json`);
  const config = {
    mcpServers: {
      ooda: {
        command: "tsx",
        args: [mcpServerPath],
        env: { OODA_API_URL: ORACLE.apiUrl, OODA_ORACLE_TOKEN: ORACLE.token },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config));
  console.log(`[oracle] MCP config written to ${configPath} (server ${mcpServerPath})`);
  return configPath;
}

const ORACLE_MCP_CONFIG_PATH = setupOracleMcpConfig();
```
> The MCP server is shipped as TS and launched with `tsx` (matching the runner's no-build deploy). If `bob-execution` is instead deployed as a tsup bundle, point `args` at the built `ooda-oracle-mcp.js` and use `node` as `command` — decide in Task 8 based on how the daemon actually runs on the box.

b. Thread the path + the new args into `getAgentCommand`. Change its signature to accept `mcpConfigPath`:
```ts
function getAgentCommand(
  agentType: string, prompt: string, persona?: PersonaConfig, mcpConfigPath?: string | null,
): { command: string; args: string[] } {
```
In the `claude` case (and the `default` case that also spawns claude), before `args.push(prompt)`:
```ts
      const { mcpArgs, toolsToAdd } = claudeOracleArgs(persona, mcpConfigPath ?? null);
      // ensure tools are present even if persona.allowedTools already pushed
      if (toolsToAdd.length) {
        const have = persona?.allowedTools ?? [];
        const merged = Array.from(new Set([...have, ...toolsToAdd]));
        // replace any earlier --allowedTools value
        const idx = args.indexOf("--allowedTools");
        if (idx >= 0) args[idx + 1] = merged.join(",");
        else args.push("--allowedTools", merged.join(","));
      }
      args.push(...mcpArgs);
```
c. Update the call site in `runAgent` (line ~386):
```ts
    const { command, args } = getAgentCommand(agentType, prompt, persona, ORACLE_MCP_CONFIG_PATH);
```

**Step 5: Run test + typecheck.**
Run: `cd apps/bob-execution && pnpm exec vitest run src/daemon/get-agent-command.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

**Step 6: Commit.**
```bash
git add apps/bob-execution/src/daemon/index.ts apps/bob-execution/src/daemon/get-agent-command.test.ts
git commit -m "feat(bob-execution): attach ooda-oracle MCP server to opted-in personas (Channel B)"
```

---

## Task 7: Planner persona opt-in

**Files:**
- Modify: `docs/personas/planner.yaml`
- (If Task 0 Step 1 found a DB seed) the seed source identified there.

**Step 1: Add the tool and prompt guidance.**

In `docs/personas/planner.yaml`, append to `allowed_tools`:
```yaml
  - mcp__ooda__oracle_query
```
And add to the end of `system_prompt`:
```
  Before breaking work into tasks, query the OODA knowledge base with the oracle_query
  tool for documented patterns, prior decisions, and domain knowledge relevant to the
  intent. Prefer documented decisions over assumptions, and cite which knowledge you used
  in your analysis section.
```

**Step 2: Reseed if needed.**

If Task 0 found the persona is DB-seeded (not read from yaml at request time), run the project's persona seed/sync command so `allowed_tools` and the new prompt reach `session.personaConfig`. (Find it: `grep -rn "planner" packages/*/src --include=*.ts -l | xargs grep -ln "seed\|persona"`.) Otherwise no action.

**Step 3: Verify the tool name will match.**

The daemon opt-in checks for the exact string `mcp__ooda__oracle_query`. This is `mcp__<serverKey>__<toolName>` where `serverKey` is `ooda` (from the MCP config `mcpServers.ooda`) and `toolName` is `oracle_query` (from `server.tool("oracle_query", ...)`). Confirm both match.

**Step 4: Commit.**
```bash
git add docs/personas/planner.yaml
git commit -m "feat(personas): grant planner oracle_query + knowledge-first guidance"
```

---

## Task 8: Full verification + deploy

**Step 1: Run the full app test + typecheck.**
Run:
```bash
cd apps/bob-execution && pnpm exec vitest run && pnpm exec tsc --noEmit
```
Expected: all green.

**Step 2: Repo-wide guard (no regressions in the daemon).**
Run from repo root: `pnpm exec turbo run test --filter=bob-execution`
Expected: PASS.

**Step 3: Decide the run mode on the box.**
SSH `root@hetzner-bob`; determine whether the daemon runs via `tsx` or a tsup bundle, and whether `tsx` is on the `claude` spawn PATH:
```bash
su - bob -c "which tsx && which claude && which node"
```
- If `tsx` resolves → keep the `tsx` MCP `command`.
- If not → adjust the MCP config `command`/`args` to `node` + built JS (see Task 6 note) and rebuild.

**Step 4: Set env on the daemon's EnvironmentFile.**
Add `OODA_API_URL` (the OODA base URL from Task 0 Step 2) and `OODA_ORACLE_TOKEN` (must equal OODA's server-side `OODA_ORACLE_TOKEN`) to the daemon's env file. Confirm OODA's server has `OPENAI_API_KEY` set (the oracle needs it; otherwise `oracle.query` 500s — seed/tool will degrade gracefully but return nothing).

**Step 5: Deploy.**
Push the branch to the ForgeGraph remote, fetch/checkout on the box as `bob`, restart:
```bash
ssh root@hetzner-bob 'su - bob -c "cd /home/bob/dev/gmacko-bob && git fetch origin feat/planner-oracle-bridge && git checkout -B feat/planner-oracle-bridge FETCH_HEAD"'
ssh root@hetzner-bob 'systemctl restart ooda-runner.service && journalctl -u ooda-runner -n 25 --no-pager'
```
(If the daemon is a separate systemd unit from `ooda-runner.service`, restart that unit instead — confirm with `systemctl list-units | grep -i bob`.)

**Step 6: Manual integration checks (the real proof).**
1. Start a planning session. Confirm a daemon log line: `[oracle] seed: N chunks, confidence X, queryId …`.
2. Confirm the generated prompt contains a `## Knowledge from OODA` section (inspect the spawn log / event stream).
3. Confirm the claude transcript lists `mcp__ooda__oracle_query` and the planner invokes it at least once.
4. Negative: unset `OODA_ORACLE_TOKEN` (or stop OODA) and restart; start a planning session; confirm it **completes cleanly** with `[oracle] seed query skipped: …` and no `## Knowledge from OODA` section, no tool, no error.

**Step 7: Final commit / PR.**
```bash
git add -A && git commit -m "docs: planner-oracle bridge verification notes" || true
gh pr create --fill --base master
```

---

## Notes for the implementer

- **DRY:** `formatOracleSection` (prompt) and `renderToolText` (tool) are deliberately separate — one targets the planner's prompt voice, the other the tool-call return. Don't merge them.
- **YAGNI:** No feedback logging (`oracle.logFeedback`) in this pass — `queryId` is logged for a future hook.
- **Non-blocking invariant:** every oracle failure path must `return ""` / `isError` and let the session continue. If you find yourself adding a `throw` on the oracle path, stop.
- **Self-contained daemon:** do not import OODA's `AppRouter` type into `apps/bob-execution`; the hand-typed `OracleClient` interface is intentional.

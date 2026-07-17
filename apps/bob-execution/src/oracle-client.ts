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
  return [intent, notes].filter((s) => s?.trim()).join("\n\n").trim();
}

/** Render oracle chunks as a prompt section. Returns "" when there are no chunks. */
export function formatOracleSection(result: OracleQueryResult): string {
  if (!result.chunks.length) return "";
  const lines = result.chunks.map((c, i) => {
    const title = c.sourceTitle?.trim() ?? "untitled source";
    const content = c.content.trim().replace(/\s+/g, " ");
    return `${i + 1}. [${title}] ${content}`;
  });
  return [
    `## Knowledge from OODA (oracle, confidence ${result.confidence.toFixed(2)})`,
    ...lines,
    `_Use the oracle_query tool to dig deeper into any of these._`,
  ].join("\n");
}

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

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.oracle.query.query({
        task: "bob planning",
        repo: params.repo,
        question,
        topK: params.topK ?? DEFAULT_TOPK,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`oracle timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
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
  } finally {
    // Clear the timeout so a winning query doesn't leave a dangling timer that
    // later rejects with no handler (unhandled rejection) in the long-lived daemon.
    if (timer) clearTimeout(timer);
  }
}

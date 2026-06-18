import { sql, eq, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "../db/schema";
import { generateEmbedding } from "./embeddings";

type DB = PostgresJsDatabase<typeof schema>;

interface VaultRetrievalTables {
  sources: typeof schema.researchVaultSources;
  retrievalUnit: typeof schema.researchVaultRetrievalUnits;
  retrievalUnitEmbedding: typeof schema.researchVaultRetrievalUnitEmbeddings;
}

export interface OracleQueryInput {
  task: string;
  repo?: string;
  question: string;
  topK?: number;
}

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
  contentAsOf: Date | null;
}

export interface OracleQueryResult {
  chunks: OracleChunk[];
  confidence: number;
  queryId: string;
  latencyMs: number;
}

export async function oracleQuery(
  db: DB,
  tables: VaultRetrievalTables,
  input: OracleQueryInput,
  apiKey: string,
): Promise<OracleQueryResult> {
  const start = performance.now();
  const topK = input.topK ?? 8;
  const queryText = `${input.task} ${input.question}`;

  const embeddingResult = await generateEmbedding(queryText, apiKey);

  const [semanticResults, fullTextResults] = await Promise.all([
    vectorSearch(db, tables, embeddingResult.embedding, topK * 3),
    fullTextSearch(db, tables, queryText, topK * 3).catch(() => [] as ScoredUnit[]),
  ]);

  const merged = mergeAndRank(semanticResults, fullTextResults, topK);

  const latencyMs = Math.round(performance.now() - start);

  let queryId: string = crypto.randomUUID();
  try {
    const { oracleQueryLog } = await import("../db/schema");
    const logResult = await db
      .insert(oracleQueryLog)
      .values({
        taskDescription: input.task,
        repoContext: input.repo ?? null,
        question: input.question,
        unitsReturned: merged.map((c) => c.unitId),
        confidence: merged.length > 0 ? merged[0]!.score : 0,
        latencyMs,
      })
      .returning({ id: oracleQueryLog.id });
    queryId = logResult[0]!.id;
  } catch {
    // query logging is best-effort
  }

  return {
    chunks: merged,
    confidence: merged.length > 0 ? merged[0]!.score : 0,
    queryId,
    latencyMs,
  };
}

interface ScoredUnit {
  unitId: string;
  sourceId: number;
  content: string;
  tokenCount: number;
  headingContext: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceKind: string;
  contentAsOf: Date | null;
  semanticScore: number;
  fullTextScore: number;
  recencyFactor: number;
  sourceQuality: number;
}

async function vectorSearch(
  db: DB,
  tables: VaultRetrievalTables,
  embedding: number[],
  limit: number,
): Promise<ScoredUnit[]> {
  const vecSql = sql.raw(`'[${embedding.join(",")}]'::vector`);

  const rows = await db.execute(sql`
    SELECT
      ru.id as unit_id,
      ru.source_id,
      ru.content,
      ru.token_count,
      ru.heading_context,
      ru.source_quality,
      ru.content_as_of,
      s.title,
      s.url,
      s.kind,
      (rue.embedding <=> ${vecSql}) as distance
    FROM research_vault.retrieval_unit_embedding rue
    INNER JOIN research_vault.retrieval_unit ru ON rue.unit_id = ru.id
    INNER JOIN research_vault.sources s ON ru.source_id = s.id
    ORDER BY rue.embedding <=> ${vecSql}
    LIMIT ${limit}
  `);

  return (rows as any[]).map((r: any) => ({
    unitId: r.unit_id,
    sourceId: r.source_id,
    content: r.content,
    tokenCount: r.token_count,
    headingContext: r.heading_context,
    sourceTitle: r.title,
    sourceUrl: r.url,
    sourceKind: r.kind,
    contentAsOf: r.content_as_of,
    semanticScore: 1 - Number(r.distance),
    fullTextScore: 0,
    recencyFactor: computeRecency(r.content_as_of ? new Date(r.content_as_of) : null),
    sourceQuality: Number(r.source_quality),
  }));
}

async function fullTextSearch(
  db: DB,
  tables: VaultRetrievalTables,
  queryText: string,
  limit: number,
): Promise<ScoredUnit[]> {
  const tsQuery = sql`websearch_to_tsquery('english', ${queryText})`;
  const tsRank = sql<number>`ts_rank(to_tsvector('english', ${tables.retrievalUnit.content}), ${tsQuery})`;

  const rows = await db
    .select({
      unitId: tables.retrievalUnit.id,
      sourceId: tables.retrievalUnit.sourceId,
      content: tables.retrievalUnit.content,
      tokenCount: tables.retrievalUnit.tokenCount,
      headingContext: tables.retrievalUnit.headingContext,
      sourceQuality: tables.retrievalUnit.sourceQuality,
      contentAsOf: tables.retrievalUnit.contentAsOf,
      sourceTitle: tables.sources.title,
      sourceUrl: tables.sources.url,
      sourceKind: tables.sources.kind,
      rank: tsRank,
    })
    .from(tables.retrievalUnit)
    .innerJoin(
      tables.sources,
      eq(tables.retrievalUnit.sourceId, tables.sources.id),
    )
    .where(
      sql`to_tsvector('english', ${tables.retrievalUnit.content}) @@ ${tsQuery}`,
    )
    .orderBy(desc(tsRank))
    .limit(limit);

  const maxRank = rows.length > 0 ? Math.max(...rows.map((r) => r.rank)) : 1;

  return rows.map((r) => ({
    unitId: r.unitId,
    sourceId: r.sourceId,
    content: r.content,
    tokenCount: r.tokenCount,
    headingContext: r.headingContext,
    sourceTitle: r.sourceTitle,
    sourceUrl: r.sourceUrl,
    sourceKind: r.sourceKind,
    contentAsOf: r.contentAsOf,
    semanticScore: 0,
    fullTextScore: maxRank > 0 ? r.rank / maxRank : 0,
    recencyFactor: computeRecency(r.contentAsOf),
    sourceQuality: r.sourceQuality,
  }));
}

function computeRecency(contentAsOf: Date | null): number {
  if (!contentAsOf) return 0.5;
  const daysSince =
    (Date.now() - contentAsOf.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - daysSince / 365);
}

function mergeAndRank(
  semantic: ScoredUnit[],
  fullText: ScoredUnit[],
  topK: number,
): OracleChunk[] {
  const merged = new Map<string, ScoredUnit>();

  for (const unit of semantic) {
    merged.set(unit.unitId, unit);
  }

  for (const unit of fullText) {
    const existing = merged.get(unit.unitId);
    if (existing) {
      existing.fullTextScore = unit.fullTextScore;
    } else {
      merged.set(unit.unitId, unit);
    }
  }

  const scored = Array.from(merged.values()).map((u) => {
    const score =
      0.6 * u.semanticScore +
      0.2 * u.recencyFactor +
      0.1 * u.sourceQuality +
      0.1 * u.fullTextScore;
    return { ...u, combinedScore: score };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  return scored.slice(0, topK).map((u) => ({
    unitId: u.unitId,
    sourceId: u.sourceId,
    content: u.content,
    tokenCount: u.tokenCount,
    headingContext: u.headingContext,
    score: u.combinedScore,
    sourceTitle: u.sourceTitle,
    sourceUrl: u.sourceUrl,
    sourceKind: u.sourceKind,
    contentAsOf: u.contentAsOf,
  }));
}

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { eq, and } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "../../db/schema";
import { ingestAndEmbed } from "../ingest";

type DB = PostgresJsDatabase<typeof schema>;

interface VaultTables {
  sources: typeof schema.researchVaultSources;
  retrievalUnit: typeof schema.researchVaultRetrievalUnits;
  retrievalUnitEmbedding: typeof schema.researchVaultRetrievalUnitEmbeddings;
}

interface FieldtheoryBookmark {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  syncedAt: string;
  articleTitle?: string | null;
  articleText?: string | null;
  articleSite?: string | null;
  links?: string[];
  media?: string[];
  quotedTweet?: {
    text: string;
    authorHandle: string;
    url: string;
  } | null;
  engagement?: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
    viewCount?: number;
  } | null;
}

function parsePostedAt(postedAt: string | null | undefined): Date | undefined {
  if (!postedAt) return undefined;
  const iso = new Date(postedAt);
  if (!isNaN(iso.getTime())) return iso;
  // Twitter's format: "Wed Oct 10 20:19:24 +0000 2018"
  const twitterDate = new Date(Date.parse(postedAt));
  if (!isNaN(twitterDate.getTime())) return twitterDate;
  return undefined;
}

function bookmarkToBody(bm: FieldtheoryBookmark): string {
  const parts: string[] = [];

  if (bm.authorName || bm.authorHandle) {
    parts.push(`**@${bm.authorHandle ?? "unknown"}** (${bm.authorName ?? ""})`);
  }

  parts.push(bm.text);

  if (bm.quotedTweet?.text) {
    parts.push(`\n> **@${bm.quotedTweet.authorHandle}**: ${bm.quotedTweet.text}`);
  }

  if (bm.articleTitle && bm.articleText) {
    parts.push(`\n## ${bm.articleTitle}\n\n${bm.articleText}`);
  }

  if (bm.links && bm.links.length > 0) {
    parts.push(`\nLinks: ${bm.links.join(", ")}`);
  }

  return parts.join("\n\n");
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ tweetId: string; error: string }>;
}

export async function importFieldtheoryJsonl(
  db: DB,
  tables: VaultTables,
  jsonlPath: string,
  options?: { embed?: boolean; apiKey?: string },
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  const rl = createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let bm: FieldtheoryBookmark;
    try {
      bm = JSON.parse(line) as FieldtheoryBookmark;
    } catch {
      result.errors.push({ tweetId: "unknown", error: "Invalid JSON line" });
      continue;
    }

    try {
      const body = bookmarkToBody(bm);
      const contentHash = createHash("sha256").update(body).digest("hex");

      const existing = await db
        .select({ id: tables.sources.id })
        .from(tables.sources)
        .where(
          and(
            eq(tables.sources.kind, "x-bookmark"),
            eq(tables.sources.externalId, bm.tweetId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const existingRow = existing[0]!;
        const existingHash = await db
          .select({ contentHash: tables.sources.contentHash })
          .from(tables.sources)
          .where(eq(tables.sources.id, existingRow.id))
          .limit(1);

        if (existingHash[0]?.contentHash === contentHash) {
          result.skipped++;
          continue;
        }

        await db
          .update(tables.sources)
          .set({
            body,
            contentHash,
            title: bm.articleTitle ?? `@${bm.authorHandle ?? "unknown"}: ${bm.text.slice(0, 80)}`,
            url: bm.url,
            author: bm.authorHandle ?? null,
            sourceTs: parsePostedAt(bm.postedAt) ?? null,
          })
          .where(eq(tables.sources.id, existingRow.id));

        if (options?.embed && options.apiKey) {
          await ingestAndEmbed(
            db,
            tables,
            { sourceId: existingRow.id, body, contentAsOf: parsePostedAt(bm.postedAt) },
            options.apiKey,
          );
        }
        result.imported++;
        continue;
      }

      const [inserted] = await db
        .insert(tables.sources)
        .values({
          kind: "x-bookmark",
          externalId: bm.tweetId,
          title: bm.articleTitle ?? `@${bm.authorHandle ?? "unknown"}: ${bm.text.slice(0, 80)}`,
          body,
          contentHash,
          url: bm.url,
          author: bm.authorHandle ?? null,
          sourceTs: parsePostedAt(bm.postedAt) ?? null,
          frontmatter: JSON.stringify({
            engagement: bm.engagement,
            links: bm.links,
            media: bm.media,
          }),
        })
        .returning({ id: tables.sources.id });

      if (options?.embed && options.apiKey && inserted) {
        await ingestAndEmbed(
          db,
          tables,
          { sourceId: inserted.id, body, contentAsOf: parsePostedAt(bm.postedAt) },
          options.apiKey,
        );
      }

      result.imported++;
    } catch (e) {
      result.errors.push({
        tweetId: bm.tweetId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

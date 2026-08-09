/**
 * Bulk-import a Grok account export (prod-grok-backend.json) into the OODA
 * research-vault KB. The export is huge (100s of MB), so we STREAM it and
 * bracket-match one conversation entry at a time — never loading the whole file
 * — then reuse the tested parser + source-record shaper and upsert into
 * research_vault.sources (dedup on (kind, external_id)).
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx scripts/import-grok-export.ts <path-to/prod-grok-backend.json> [--dry-run] [--batch=500]
 *
 * --dry-run parses + counts only (no DB, no DATABASE_URL needed). Run it first
 * to sanity-check the counts.
 */
import { createReadStream } from "node:fs";

import { parseGrok } from "../packages/ooda/src/imports/parsers/grok.js";
import { conversationToSourceRecord } from "../packages/ooda/src/imports/to-source-record.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
// --emit-sql: write upsert SQL to stdout instead of connecting (pipe to psql on
// a host that can reach the DB). All progress/log lines go to stderr so stdout
// stays pure SQL.
const emitSql = args.includes("--emit-sql");
const batchSize = Number(
  args.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? 500,
);

const sqlStr = (v: string | null | undefined): string =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

if (!file) {
  console.error("usage: tsx scripts/import-grok-export.ts <file> [--dry-run] [--batch=N]");
  process.exit(1);
}

type SourceRow = ReturnType<typeof conversationToSourceRecord>;

async function main() {
  // Lazy DB setup — not needed for --dry-run / --emit-sql.
  let insertBatch: (rows: SourceRow[]) => Promise<void> = async () => {};
  let closeDb: () => Promise<void> = async () => {};
  if (emitSql) {
    insertBatch = async (rows) => {
      if (rows.length === 0) return;
      const values = rows
        .map(
          (r) =>
            `(${sqlStr(r.kind)}, ${sqlStr(r.externalId)}, ${sqlStr(r.title)}, ` +
            `${sqlStr(r.body)}, ${sqlStr(r.contentHash)}, ${sqlStr(r.author ?? null)}, ` +
            `${r.sourceTs ? `${sqlStr(new Date(r.sourceTs).toISOString())}::timestamptz` : "NULL"})`,
        )
        .join(",\n");
      process.stdout.write(
        `insert into research_vault.sources (kind, external_id, title, body, content_hash, author, source_ts) values\n${values}\n` +
          `on conflict (kind, external_id) do update set title = excluded.title, body = excluded.body, content_hash = excluded.content_hash;\n`,
      );
    };
  } else if (!dryRun) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error("DATABASE_URL is required (or pass --dry-run)");
      process.exit(1);
    }
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 4 });
    closeDb = () => sql.end({ timeout: 5 });
    insertBatch = async (rows) => {
      if (rows.length === 0) return;
      // Upsert each row; ON CONFLICT keeps the KB idempotent across re-runs.
      await sql`
        insert into research_vault.sources
          (kind, external_id, title, body, content_hash, author, source_ts)
        values ${sql(
          rows.map((r) => [
            r.kind,
            r.externalId,
            r.title,
            r.body,
            r.contentHash,
            r.author ?? null,
            r.sourceTs ? new Date(r.sourceTs) : null,
          ]),
        )}
        on conflict (kind, external_id) do update
          set title = excluded.title,
              body = excluded.body,
              content_hash = excluded.content_hash
      `;
    };
  }

  let convCount = 0;
  let msgCount = 0;
  let inserted = 0;
  let pending: SourceRow[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    await insertBatch(pending);
    inserted += pending.length;
    pending = [];
    process.stderr.write(`\r  processed ${inserted} conversations…`);
  };

  // Handle one streamed conversation entry (raw JSON text of a single object).
  const handleEntry = async (entryJson: string) => {
    let entry: unknown;
    try {
      entry = JSON.parse(entryJson);
    } catch {
      return; // skip malformed entry
    }
    const convs = parseGrok({ conversations: [entry] });
    for (const conv of convs) {
      convCount += 1;
      msgCount += conv.messages.length;
      if (!dryRun) {
        pending.push(conversationToSourceRecord(conv));
        if (pending.length >= batchSize) await flush();
      }
    }
  };

  // Streaming bracket-matcher: after the `conversations` array's opening `[`,
  // capture each top-level {...} object (respecting strings/escapes).
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { encoding: "utf8" });
    let started = false; // seen the opening '['
    let depth = 0;
    let inStr = false;
    let esc = false;
    let cur = "";
    let chain: Promise<void> = Promise.resolve();

    stream.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (!started) {
          if (c === "[") started = true;
          continue;
        }
        if (inStr) {
          cur += c;
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') {
          inStr = true;
          cur += c;
          continue;
        }
        if (c === "{") {
          depth += 1;
          cur += c;
          continue;
        }
        if (c === "}") {
          depth -= 1;
          cur += c;
          if (depth === 0) {
            const entryJson = cur;
            cur = "";
            chain = chain.then(() => handleEntry(entryJson));
          }
          continue;
        }
        if (depth > 0) cur += c;
      }
    });
    stream.on("end", () => {
      chain.then(resolve).catch(reject);
    });
    stream.on("error", reject);
  });

  await flush();
  await closeDb();
  process.stderr.write("\n");
  console.error(
    `${dryRun ? "[dry-run] " : emitSql ? "[emit-sql] " : ""}parsed ${convCount} conversations, ${msgCount} messages` +
      (dryRun || emitSql ? "" : `, upserted ${inserted} into research_vault.sources`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

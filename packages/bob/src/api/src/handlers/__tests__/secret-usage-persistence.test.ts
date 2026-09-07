import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@bob/db/schema";
import { SessionSecretService  } from "../../services/secrets/sessionSecretService";
import type {DatabaseLike} from "../../services/secrets/sessionSecretService";

const databaseUrl = process.env.BOB_AUTH_TEST_DATABASE_URL;
// Opt-in only: this test must never inherit a developer's DATABASE_URL.
const fixtureSchema = `auth_test_${randomUUID().replaceAll("-", "")}`;
const ids = { session: randomUUID(), otherSession: randomUUID(), secret: randomUUID(), otherSecret: randomUUID() };
let admin: Pool | undefined;
let pool: Pool;
let cleanupPool: Pool | undefined;
let service: SessionSecretService;

describe.skipIf(!databaseUrl)("durable session secret usage", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("BOB_AUTH_TEST_DATABASE_URL is required");
    const url = new URL(databaseUrl);
    if (url.hostname !== "127.0.0.1" || !(url.pathname === "/bob_phase_b" || /^\/bob_auth_test_[a-z0-9_]+$/.test(url.pathname))) throw new Error("Requires dedicated loopback bob_auth_test_* or bob_phase_b test database");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${fixtureSchema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${fixtureSchema}`, max: 4 });
    cleanupPool = pool;
    await pool.query(`
      CREATE TABLE chat_conversations (id uuid PRIMARY KEY, user_id text NOT NULL);
      CREATE TABLE session_secrets (id uuid PRIMARY KEY, session_id uuid REFERENCES chat_conversations(id), user_id text NOT NULL);
      CREATE TABLE session_secret_usages (
        id uuid PRIMARY KEY, secret_id uuid NOT NULL REFERENCES session_secrets(id),
        session_id uuid NOT NULL REFERENCES chat_conversations(id), executor varchar(32) NOT NULL,
        template_id varchar(64), command_preview text, exit_code integer, duration_ms integer,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await pool.query("INSERT INTO chat_conversations VALUES ($1, 'alice'), ($2, 'bob')", [ids.session, ids.otherSession]);
    await pool.query("INSERT INTO session_secrets VALUES ($1, $2, 'alice'), ($3, $4, 'bob')", [ids.secret, ids.session, ids.otherSecret, ids.otherSession]);
    const db = drizzle(pool, { schema, casing: "snake_case" });
    // Use real Drizzle authorization predicates over the deliberately minimal
    // fixture tables. Projection excludes unrelated conversation/secret columns.
    service = new SessionSecretService({
      query: {
        chatConversations: { findFirst: (args: object) => db.query.chatConversations.findFirst({ ...args, columns: { id: true, userId: true } }) },
        sessionSecrets: { findFirst: (args: object) => db.query.sessionSecrets.findFirst({ ...args, columns: { id: true, userId: true, sessionId: true } }) },
        sessionSecretUsages: db.query.sessionSecretUsages,
      },
      insert: db.insert.bind(db),
    } as unknown as DatabaseLike);
  });
  afterAll(async () => {
    await cleanupPool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${fixtureSchema} CASCADE`); await admin.end(); }
  });

  it("persists one receipt for concurrent retries and rejects changed metadata", async () => {
    const input = { usageId: randomUUID(), userId: "alice", secretId: ids.secret, sessionId: ids.session, executor: "broker", exitCode: 0 };
    const receipts = await Promise.all(Array.from({ length: 8 }, () => service.markSecretUsed(input)));
    expect(new Set(receipts.map((row) => row.id))).toEqual(new Set([input.usageId]));
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM session_secret_usages WHERE id = $1", [input.usageId])).rows[0]?.count).toBe(1);
    await expect(service.markSecretUsed({ ...input, exitCode: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("denies cross-user receipts and never returns another principal's colliding receipt", async () => {
    const usageId = randomUUID();
    await service.markSecretUsed({ usageId, userId: "bob", secretId: ids.otherSecret, sessionId: ids.otherSession, executor: "broker" });
    await expect(service.markSecretUsed({ usageId, userId: "alice", secretId: ids.otherSecret, sessionId: ids.otherSession, executor: "broker" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.markSecretUsed({ usageId, userId: "alice", secretId: ids.secret, sessionId: ids.session, executor: "broker" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

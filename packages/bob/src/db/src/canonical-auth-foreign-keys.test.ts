import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../drizzle/0036_canonical_auth_foreign_keys.sql", import.meta.url),
  "utf8",
);

async function legacyFixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY);
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE activities (id text PRIMARY KEY, user_id text,
      CONSTRAINT legacy_activity_fk FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE SET NULL);
    CREATE TABLE pending (user_id text);
    ALTER TABLE pending ADD CONSTRAINT pending_identity_fk FOREIGN KEY(user_id) REFERENCES "user"(id) NOT VALID;
    CREATE TABLE workspaces (id text PRIMARY KEY, owner_user_id text NOT NULL,
      CONSTRAINT legacy_owner_fk FOREIGN KEY(owner_user_id) REFERENCES "user"(id)
      ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED);
    INSERT INTO "user" VALUES ('existing-personal');
    INSERT INTO users VALUES ('existing-personal'), ('new-reviewer');
    INSERT INTO workspaces VALUES ('personal-workspace', 'existing-personal');
    INSERT INTO activities VALUES ('personal-activity','existing-personal');
  `);
  return db;
}

async function apply(db: PGlite) {
  await db.exec("BEGIN");
  try {
    await db.exec(migration);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

describe("canonical auth identity foreign-key migration", () => {
  it("preserves personal data and constraint behavior while allowing canonical-only reviewers", async () => {
    const db = await legacyFixture();
    try {
      await apply(db);
      await db.exec(
        "INSERT INTO workspaces VALUES ('reviewer-workspace','new-reviewer')",
      );
      const rows = await db.query<{ id: string; owner_user_id: string }>(
        "SELECT * FROM workspaces ORDER BY id",
      );
      expect(rows.rows).toEqual([
        { id: "personal-workspace", owner_user_id: "existing-personal" },
        { id: "reviewer-workspace", owner_user_id: "new-reviewer" },
      ]);
      const fk = await db.query<{
        target: string;
        deferrable: boolean;
        deferred: boolean;
        delete_action: string;
      }>(
        `SELECT confrelid::regclass::text AS target, condeferrable AS deferrable, condeferred AS deferred, confdeltype AS delete_action FROM pg_constraint WHERE conname='legacy_owner_fk'`,
      );
      expect(fk.rows).toEqual([
        {
          target: "users",
          deferrable: true,
          deferred: true,
          delete_action: "c",
        },
      ]);
      const pending = await db.query<{ validated: boolean }>(
        "SELECT convalidated AS validated FROM pg_constraint WHERE conname='pending_identity_fk'",
      );
      expect(pending.rows).toEqual([{ validated: false }]);
      await apply(db);
      await expect(
        db.exec("INSERT INTO workspaces VALUES ('invalid','absent')"),
      ).rejects.toThrow();
      await db.exec(
        "INSERT INTO activities VALUES ('reviewer-activity','new-reviewer'); DELETE FROM users WHERE id='new-reviewer'",
      );
      const activities = await db.query<{ user_id: string | null }>(
        "SELECT user_id FROM activities WHERE id='reviewer-activity'",
      );
      expect(activities.rows).toEqual([{ user_id: null }]);
      const remaining = await db.query<{ id: string }>(
        "SELECT id FROM workspaces",
      );
      expect(remaining.rows).toEqual([{ id: "personal-workspace" }]);
    } finally {
      await db.close();
    }
  }, 20_000);

  it("rolls back without touching legacy constraints or rows when a canonical identity is missing", async () => {
    const db = await legacyFixture();
    try {
      await db.exec("DELETE FROM users WHERE id='existing-personal'");
      await expect(apply(db)).rejects.toThrow();
      const fk = await db.query<{ target: string }>(
        "SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conname='legacy_owner_fk'",
      );
      expect(fk.rows).toEqual([{ target: '"user"' }]);
      const rows = await db.query<{ id: string }>("SELECT id FROM workspaces");
      expect(rows.rows).toEqual([{ id: "personal-workspace" }]);
    } finally {
      await db.close();
    }
  }, 20_000);
});

it("rejects orphaned references in a previously unvalidated constraint", async () => {
  const db = await legacyFixture();
  try {
    await db.exec(
      "ALTER TABLE pending DROP CONSTRAINT pending_identity_fk; INSERT INTO pending VALUES ('orphan'); ALTER TABLE pending ADD CONSTRAINT pending_identity_fk FOREIGN KEY(user_id) REFERENCES \"user\"(id) NOT VALID",
    );
    await expect(apply(db)).rejects.toThrow();
    const fk = await db.query<{ target: string }>(
      "SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conname='legacy_owner_fk'",
    );
    expect(fk.rows).toEqual([{ target: '"user"' }]);
  } finally {
    await db.close();
  }
}, 20_000);

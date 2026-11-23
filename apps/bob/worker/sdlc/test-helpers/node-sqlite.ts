import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlPort } from "../sql";

export interface TestSqlPort extends SqlPort {
  /** Every statement run, for asserting what a call wrote. */
  readonly statements: string[];
  /** Makes the next statement matching pattern throw, to simulate a storage failure. */
  failNext(pattern: RegExp): void;
}

/** A SqlPort over node:sqlite for tests. Pass the same port to a new store to simulate a restart. */
export function nodeSqlitePort(path = ":memory:"): TestSqlPort {
  const db = new DatabaseSync(path);
  const statements: string[] = [];
  let failure: RegExp | null = null;
  let depth = 0;
  return {
    statements,
    failNext: (pattern) => { failure = pattern; },
    exec<T>(sql: string, ...bindings: unknown[]): T[] {
      if (failure?.test(sql)) { failure = null; throw new Error(`injected storage failure: ${sql}`); }
      statements.push(sql);
      return db.prepare(sql).all(...(bindings as SQLInputValue[])) as T[];
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      db.exec("BEGIN");
      depth++;
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        depth--;
      }
    },
  };
}

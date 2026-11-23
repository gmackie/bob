/// <reference types="@cloudflare/workers-types" />

/**
 * The synchronous SQL the SDLC edge needs. Production wraps a SQLite-backed Durable
 * Object's storage (durableObjectSql); tests wrap node:sqlite (test-helpers/node-sqlite.ts).
 */
export interface SqlPort {
  exec<T = Record<string, unknown>>(sql: string, ...bindings: unknown[]): T[];
  /** Runs fn atomically: all of its writes commit, or none do and the error is rethrown. */
  transaction<T>(fn: () => T): T;
}

/** Types only: nothing here imports cloudflare:workers at runtime. */
export function durableObjectSql(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">): SqlPort {
  return {
    exec: <T>(sql: string, ...bindings: unknown[]) => storage.sql.exec(sql, ...(bindings as SqlStorageValue[])).toArray() as T[],
    transaction: (fn) => storage.transactionSync(fn),
  };
}

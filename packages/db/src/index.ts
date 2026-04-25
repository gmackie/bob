export { getDb, type Database } from "./client";
// `migrate` / `runMigrations` deliberately NOT re-exported here — they pull in
// `drizzle-orm/pglite/migrator`, which has top-level Node-only imports
// (`node:fs`, `node:path`, `node:url`) that webpack's `UnhandledSchemeError`
// surfaces when the root barrel is reached transitively from a client bundle
// (via `@gmacko/agent` → `@gmacko/contracts` tagged-error classes →
// `@gmacko/client` → `@gmacko/app-shell`'s `RpcClientProvider`). Server-only
// consumers import migrations via the `./migrate` subpath instead.
export * from "./schema";
export * from "./service.js";

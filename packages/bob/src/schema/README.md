# Bob schema boundary

This package owns Bob's table definitions, relation definitions, enums and schema-derived validators. It depends on Drizzle, Zod and shared core infrastructure, never on Bob services or database clients. Its cross-domain foreign keys use relative imports inside this single build unit.

Domain packages retain their existing `@bob/<area>/schema` exports as compatibility facades. `@bob/db/schema` aggregates the same objects directly from this package, so constructing a database client cannot create a build dependency on authentication or another service that uses that client. Do not copy table definitions into those facades: Drizzle relies on their object identity.

This is a source ownership change, with no table, column, index or foreign-key changes and no database migration. Topological `^build` dependencies remain enabled. The workspace graph regression is `node --test scripts/bob-build-graph.test.mjs`; the runtime identity regression is `pnpm exec tsx --test scripts/bob-schema-compatibility.test.mjs` from the repository root.

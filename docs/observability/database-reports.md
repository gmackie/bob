# Private database latency reports

Bob uses the PostgreSQL adapter in `@forgegraph/otel@0.1.8` with its existing `withTraceSpan` implementation. Queries therefore inherit the current Worker or Node trace. The adapter does not initialize a second tracer. The shared core PostgreSQL factory and Bob's request-scoped Worker PostgreSQL factory are instrumented; native receivers, lazy execution, row modes and transactions are preserved.

```sh
python3 scripts/otel/test-database.py
```

The command provisions an owned local PostgreSQL cluster on an available loopback port, runs the production core database factory inside Bob's real Worker trace wrapper, then stops and removes the cluster. PostgreSQL tools must be installed; `PG_BIN` may select their bin directory. The test checks request-to-query ancestry, reads/writes, nested rollback behavior, and exclusion of SQL text, bound values and raw errors. It never uses the ambient application database.

CI retains revision-linked JSON/HTML graphs under `packages/core/.fg/observability/database/` as private repository artifacts for seven days. Generated reports are ignored locally and must not be published to public report hosts. The regular telemetry suite skips this database contract without an explicit test database; the owned-cluster command runs it without skipping.

PGlite and Neon HTTP factories are separate drivers and are not covered by this adapter. Trusted ForgeGraph PR/deployment ownership correlation also remains separate from the existing task trace carrier. A matching trace ID is not authorization to read another service's data.

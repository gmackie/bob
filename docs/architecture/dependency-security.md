# Dependency security maintenance

Verified 2026-09-06 with Node 24.20.0 and pnpm 10.12.1. This is an implementation receipt and operating reference, not a claim that third-party dependencies are vulnerability-free.

## Audit results

| Scope | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: |
| Initial complete workspace lock | 3 | 112 | 108 | 20 |
| Remediated complete workspace lock | 0 | 3 | 0 | 0 |
| Remediated production dependencies | 0 | 2 | 0 | 0 |

The remaining advisory records describe upstream versions without published fixes. They remain visible in `pnpm audit`; no `auditConfig.ignore*` setting or advisory suppression was added. The deployed workspace applies the two checked-in patches below via `pnpm.patchedDependencies`; their hashes are recorded in the lockfile and verified on frozen install. Ordinary `npm install` does not apply pnpm patches and is not an equivalent workspace installation.

| Package | Advisory | Local remediation | SHA-256 of checked-in patch |
| --- | --- | --- | --- |
| image-size 1.2.1 | [ICNS loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL/HEIF loops](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | Reject undersized/nonadvancing entry and box headers before traversal, including matching boxes; reject truncated ICNS entries | `a442ee5795445d07c56a9c8d43b54e7b3893765322f66d3abb4bc8a5abd57889` |
| extract-zip 2.0.1 | [Symlink traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) | Validate archive link targets against the canonical extraction root and resolve existing ancestors; reject escapes and unresolved symlink ancestors while retaining internal and forward bundle links | `e7d6cc447dc3a9088913db5acc66116ea7847562a50618deb417764ccb003359` |

`node --test scripts/dependency-security.test.mjs` exercises the actual installed owner dependency graph. Malformed images run in a subprocess with a hard timeout so an infinite loop cannot hang CI. The archive fixture is built locally without downloads or system ZIP utilities. Coverage includes relative/absolute outside links, existing outside ancestors, internal forward links, internal directory links, and valid PNG dimensions. The unpatched packages fail the malformed-image timeout and expected archive rejection; the patched graph passes all three tests. This test runs after installation in CI. These are parser/archive containment fixes, not an OS sandbox against another local process racing filesystem operations.

## Version and graph changes

- Vitest 3 stays on its maintained 3.2 patch line; Vitest 4 stays on 4.1. Critical UI-server fixes are included. See the [maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).
- Vite 8 deployed applications use 8.0.16; the separate Vite 7 catalog uses 7.3.5. Vinext stays at 0.0.41 and its previously verified RSC/React closure remains pinned.
- Electron is explicitly pinned to 41.10.3. The Electron 40 line has no fix for the final iframe popup advisory; this is a deliberate major upgrade, not a transitive override. See the [maintainer advisory and affected lines](https://github.com/electron/electron/security/advisories/GHSA-9f4c-93c8-jc8g). Electron Builder and its Squirrel peer match 26.15.3 so an old automatically installed peer cannot retain Builder 25.
- All direct Drizzle consumers use 0.45.2. API and Blder now declare their previously implicit Drizzle imports. Exact-version package extensions declare the actual `drizzle-orm` imports in Drizzle Kit 0.31.10 and BetterAuth 1.4.0-beta.9. Strict/external-store installation exposed these imports, formerly hidden by root hoisting.
- OpenTelemetry SDK 0.222 and stable SDK 2.11 migrate both initializers from the removed `Resource` constructor to `resourceFromAttributes`. A local HTTP collector smoke test verified the actual named span, service resource, and shutdown flush. See the [SDK 2 migration announcement](https://opentelemetry.io/blog/2025/otel-js-sdk-2-0/).
- Unused `@traceloop/node-server-sdk` was removed from telemetry and the standalone daemon manifest; no source imported it. This removes obsolete LangChain/Google SDK and OpenTelemetry 1 dependency branches. The daemon external list was cleaned to match.
- Security overrides are centralized in root `package.json#pnpm`; stale duplicate workspace overrides were removed. Most are bounded to an existing major line. Explicit parent-scoped migrations cover the mobile Markdown renderer's Markdown-it 14.2 API, query-string's decode-uri-component 0.5, Effect's TOML 4.2 parser, Miniflare's sharp 0.35.4, and esbuild-kit's transform API. UUID 11 retains the CommonJS `v4` entry used by the old tool consumers. No global forced UUID ESM major is introduced.
- The standalone daemon manifest was aligned to tRPC 11.8, WebSocket 8.21 and the new OpenTelemetry graph. Deployment still requires rebuilding and verifying the standalone bundle; the workspace lockfile is not an npm runtime lock.
- Notification preference regression files now have an executable package test task and Vitest dependency, so the CI package task graph includes them.

## Reverification

Run `pnpm install --frozen-lockfile`, `pnpm audit --json`, `pnpm audit --prod --json`, and `node --test scripts/dependency-security.test.mjs`. Then run the repository typechecks, affected database authorization/migration tests, mobile tests, web builds, desktop packaging, and standalone daemon acceptance. An offline frozen install also passed against the prepared package store. Passing audit metadata alone does not prove application compatibility or a shipped binary.

When an upstream fixed image-size or extract-zip release becomes available, replace the patch with that release only after the same malicious-input tests pass. Never remove the residual records by changing audit configuration.

## Portable desktop resources

Desktop staging verifies every deployed registry package's version and resolution integrity against the workspace lock before accepting it, checks active patch hashes and overrides, and writes `dependency-provenance.json` into each staged application. pnpm legacy deployment can copy workspace hoists that still target the source checkout. `apps/desktop-bob/scripts/portable-deploy.mjs` redirects these only to an unambiguous actual workspace copy inside the staged closure, removes unrelated workspace aliases, and rejects other external/broken links. The Node app now declares its external PostgreSQL, PGlite and migration dependencies directly. The server wrapper's unused application/database runtime dependencies were removed; staging explicitly builds and packages those separate resources. Electron is a desktop build dependency, as required by Electron Builder, rather than an application runtime package.

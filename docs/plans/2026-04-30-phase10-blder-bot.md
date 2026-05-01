# Phase 10: blder.bot Platform — Auth Hub, OODA Vinext Port, Bob Subdomain

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy three CF Workers apps — shared auth hub at `blder.bot`, OODA at `ooda.blder.bot`, Bob at `bob.blder.bot` — with shared better-auth sessions via `.blder.bot` cookie domain.

**Architecture:** A shallow platform app at `blder.bot` owns auth routes (`/api/auth/*`), login UI, and node management. Bob moves from the apex domain to `bob.blder.bot`. OODA is ported from Next.js to Vinext and deployed to `ooda.blder.bot`. All three apps share the same Postgres via Hyperdrive and validate sessions through the `.blder.bot` cookie. Filesystem-dependent OODA routes (vault, thread workspaces, notes, publish) are excluded from the edge router — they'll be wired to labnuc's runner in Phase 3.

**Tech Stack:** Vinext 0.0.41, @cloudflare/vite-plugin, better-auth, postgres.js, Drizzle ORM, Hyperdrive, tRPC v11, React 19, Tailwind v4

---

## Task 1: Shared Auth Config — Cookie Domain

**Files:**
- Modify: `packages/core/src/auth/better-auth.ts`

**What:** Add `cookieDomain` option to `InitAuthOptions` and pass it through to `betterAuth()` config. This lets the auth instance set cookies on `.blder.bot` so they're readable by all subdomains.

**Step 1: Update InitAuthOptions interface**

Add after the `bootstrapTenancy` field:

```typescript
readonly cookieDomain?: string;
```

**Step 2: Pass cookieDomain to betterAuth config**

In `initAuth()`, add to the config object (after `trustedOrigins`):

```typescript
...(opts.cookieDomain
  ? {
      advanced: {
        crossSubDomainCookies: {
          enabled: true,
          domain: opts.cookieDomain,
        },
      },
    }
  : {}),
```

**Step 3: Verify typecheck passes**

Run: `cd packages/core && pnpm typecheck`

**Step 4: Commit**

```bash
git add packages/core/src/auth/better-auth.ts
git commit -m "feat(auth): add cookieDomain option for cross-subdomain sessions"
```

---

## Task 2: Platform App Scaffold — `apps/blder`

**Files:**
- Create: `apps/blder/package.json`
- Create: `apps/blder/tsconfig.json`
- Create: `apps/blder/vite.config.ts`
- Create: `apps/blder/wrangler.jsonc`
- Create: `apps/blder/postcss.config.mjs`
- Create: `apps/blder/src/app/globals.css`
- Create: `apps/blder/src/app/layout.tsx`
- Create: `apps/blder/src/app/page.tsx`
- Create: `apps/blder/src/app/login/page.tsx`
- Create: `apps/blder/src/app/login/_components/login-form.tsx`

**What:** Scaffold the blder.bot platform app using Vinext. Minimal landing page + login page. No tRPC yet — auth routes come in Task 3.

**Step 1: Create package.json**

```json
{
  "name": "@gmacko/blder",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "vinext dev",
    "build": "vinext build",
    "start": "vinext start",
    "deploy": "vinext deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gmacko/core": "workspace:*",
    "better-auth": "catalog:",
    "drizzle-orm": "catalog:",
    "postgres": "catalog:",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vinext": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "catalog:",
    "@gmacko/tailwind": "workspace:*",
    "@gmacko/tsconfig": "workspace:*",
    "@tailwindcss/postcss": "^4.2.0",
    "@types/node": "25.6.0",
    "@types/react": "19.2.14",
    "tailwindcss": "catalog:",
    "typescript": "^5.9.0",
    "wrangler": "catalog:"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "@gmacko/tsconfig/react-library.json",
  "compilerOptions": {
    "outDir": "dist",
    "paths": {
      "~/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", ".vinext"]
}
```

**Step 3: Create vite.config.ts**

Model after Bob's — but simpler (no BOB_BUILD_TARGET switching, always Cloudflare).

```typescript
import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;

export default defineConfig({
  plugins: [
    vinext(),
    ...(!isDev
      ? [
          cloudflare({
            viteEnvironment: {
              name: "rsc",
              childEnvironments: ["ssr"],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
});
```

**Step 4: Create wrangler.jsonc**

```jsonc
{
  "name": "blder-bot-platform",
  "main": "./worker/index.js",
  "compatibility_date": "2025-12-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "routes": [{ "pattern": "blder.bot", "custom_domain": true }],
  "assets": {
    "directory": "dist/client",
    "binding": "ASSETS",
    "not_found_handling": "none"
  },
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "c1f467f772dc4ce99d99e572df74c121"
    }
  ],
  "vars": {
    "FRONTEND_URL": "https://blder.bot",
    "NODE_ENV": "production"
  }
}
```

**Step 5: Create postcss.config.mjs**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

**Step 6: Create layout, landing page, and login page**

`src/app/globals.css`:
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@gmacko/tailwind/theme";
```

`src/app/layout.tsx` — Root layout with Tailwind, ThemeProvider.

`src/app/page.tsx` — Landing page with links to bob.blder.bot and ooda.blder.bot.

`src/app/login/page.tsx` — Login page adapted from Bob's, pointing auth calls to `/api/auth/sign-in/social`.

`src/app/login/_components/login-form.tsx` — GitHub sign-in button (same as Bob's LoginForm but with `callbackURL: "/"` and references to blder.bot platform).

**Step 7: Add to pnpm-workspace.yaml if needed**

Verify `apps/*` glob already covers `apps/blder`. It should — pnpm-workspace.yaml typically has `"apps/*"`.

**Step 8: Install dependencies**

Run: `pnpm install`

**Step 9: Verify dev server starts**

Run: `cd apps/blder && pnpm dev`

Expected: Vinext dev server starts, shows landing page at localhost.

**Step 10: Commit**

```bash
git add apps/blder/
git commit -m "feat(blder): scaffold platform app for blder.bot"
```

---

## Task 3: Platform Auth Routes

**Files:**
- Create: `apps/blder/src/lib/db-client-lazy.ts`
- Create: `apps/blder/src/auth/server.ts`
- Create: `apps/blder/src/app/api/auth/[...all]/route.ts`
- Modify: `apps/blder/vite.config.ts` (add DB + Node stubs aliases)
- Create: `apps/blder/src/lib/fs-stub.ts`
- Create: `apps/blder/src/lib/os-stub.ts`
- Create: `apps/blder/src/lib/pg-native-stub.ts`

**What:** Wire better-auth into the platform app. The auth instance uses `cookieDomain: ".blder.bot"` so cookies are shared across subdomains. DB client uses the lazy Hyperdrive proxy pattern from Bob.

**Step 1: Create Workers DB client**

Copy Bob's `db-client-lazy.ts` pattern, but import schema from `@gmacko/core/db/schema` (the shared auth tables — users, sessions, accounts, verifications, tenants, tenant_members). The platform app only needs auth tables, not Bob's or OODA's domain tables.

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@gmacko/core/db/schema";

function getDatabase() {
  const databaseUrl =
    (globalThis as any).DATABASE_URL ??
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const isHyperdrive =
    (globalThis as any).DATABASE_HYPERDRIVE === "true" ||
    process.env.DATABASE_HYPERDRIVE === "true";

  const client = postgres(databaseUrl, {
    ssl: isHyperdrive ? false : "require",
    max: 1,
    prepare: !isHyperdrive,
  });

  return drizzle(client, { schema, casing: "snake_case" });
}

type DatabaseClient = ReturnType<typeof getDatabase>;

export const db = new Proxy({} as DatabaseClient, {
  get(_target, prop) {
    const dbClient = getDatabase();
    const value = (dbClient as any)[prop as string];
    if (typeof value === "function") {
      return value.bind(dbClient);
    }
    return value;
  },
});
```

**Step 2: Create auth server**

`apps/blder/src/auth/server.ts`:

```typescript
import { initAuth } from "@gmacko/core/auth";
import { db } from "~/lib/db-client-lazy";
import * as schema from "@gmacko/core/db/schema";

const baseUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

export const auth = initAuth({
  db,
  schema: schema as unknown as Record<string, unknown>,
  pluralizeTables: true,
  baseUrl,
  productionUrl: baseUrl,
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  githubScopes: ["user:email", "repo", "read:user"],
  trustedOrigins: [
    "https://bob.blder.bot",
    "https://ooda.blder.bot",
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
  ],
  cookieDomain: ".blder.bot",
});
```

**Step 3: Create auth catch-all route**

`apps/blder/src/app/api/auth/[...all]/route.ts`:

```typescript
import { auth } from "~/auth/server";

export const GET = (request: Request) => auth.handler(request);
export const POST = (request: Request) => auth.handler(request);
```

**Step 4: Create Node stubs**

Copy Bob's `fs-stub.ts`, `os-stub.ts`, `pg-native-stub.ts` into `apps/blder/src/lib/`.

**Step 5: Update vite.config.ts with aliases**

Add Cloudflare-specific aliases for the DB client and Node stubs:

```typescript
resolve: {
  alias: {
    "~": path.resolve(__dirname, "src"),
    "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
    "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
    "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
  },
},
ssr: {
  noExternal: ["postgres", "drizzle-orm"],
  external: ["pg", "pg-native", "pg-pool", "@electric-sql/pglite"],
},
```

**Step 6: Verify typecheck and dev server**

Run: `cd apps/blder && pnpm typecheck && pnpm dev`

**Step 7: Commit**

```bash
git add apps/blder/
git commit -m "feat(blder): wire better-auth with cross-subdomain cookies"
```

---

## Task 4: Platform Node Management

**Files:**
- Create: `apps/blder/src/app/nodes/page.tsx`
- Create: `apps/blder/src/components/node-list.tsx`

**What:** Add a minimal node management page showing Tailscale-connected runner devices. This is a read-only view of the `runner_device` table (same table OODA and Bob runners register to). Uses direct DB queries — no tRPC needed for this simple admin view.

**Step 1: Create node list component**

Client component that fetches runner devices via a server action or API route. Shows device name, hostname, status, last heartbeat, capabilities.

**Step 2: Create nodes page**

Simple page at `/nodes` with the node list.

**Step 3: Update landing page**

Add a link to `/nodes` from the landing page.

**Step 4: Commit**

```bash
git add apps/blder/
git commit -m "feat(blder): add node management page"
```

---

## Task 5: OODA Edge Router

**Files:**
- Create: `packages/ooda/src/api/edge-router.ts`
- Modify: `packages/ooda/src/api/router/threads.ts` (split into edge-safe subset)

**What:** Create an edge-compatible tRPC router that excludes filesystem-dependent procedures. This router is what the CF Workers deployment will use.

**Excluded from edge:**
- `vault` router — all operations need local git repos
- `publish` router — needs local filesystem (`PERSONAL_WEBSITE_PATH`)
- `threads.create` — creates workspace directory via `createThreadWorkspace()`
- `threads.sync` — git pull + filesystem scan via `pullVault()`, `scanThreads()`
- `threads.listNotes` — reads from disk via `readNotes()`
- `threads.listDomainPacks` — reads local domain pack files
- `threads.getDomainPackTemplate` — reads local domain pack templates

**Included in edge:**
- `threads.list`, `threads.byId`, `threads.bySlug`, `threads.updateStatus` — DB-only
- `runner` — all DB-only
- `research` — all DB/HTTP-backed (sidecar calls)
- `imports` — DB-only

**Step 1: Create edge-safe threads subset**

Create `packages/ooda/src/api/router/threads-edge.ts` — exports only the 4 DB-backed procedures:

```typescript
import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";
import { desc, eq } from "@gmacko/ooda/db";
import { researchThread } from "@gmacko/ooda/db/schema";
import { publicProcedure, authedProcedure } from "../trpc";

export const threadsEdgeRouter = {
  list: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads", tags: ["threads"] } })
    .output(z.any())
    .query(({ ctx }) => {
      return ctx.db.query.researchThread.findMany({
        orderBy: desc(researchThread.createdAt),
        limit: 50,
      });
    }),

  byId: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/by-id", tags: ["threads"] } })
    .input(z.object({ id: z.string() }))
    .output(z.any())
    .query(({ ctx, input }) => {
      return ctx.db.query.researchThread.findFirst({
        where: eq(researchThread.id, input.id),
      });
    }),

  bySlug: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/threads/by-slug", tags: ["threads"] } })
    .input(z.object({ slug: z.string() }))
    .output(z.any())
    .query(({ ctx, input }) => {
      return ctx.db.query.researchThread.findFirst({
        where: eq(researchThread.slug, input.slug),
      });
    }),

  updateStatus: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/threads/update-status", tags: ["threads"], protect: true } })
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["active", "paused", "archived", "completed"]),
      }),
    )
    .output(z.any())
    .mutation(({ ctx, input }) => {
      return ctx.db
        .update(researchThread)
        .set({ status: input.status })
        .where(eq(researchThread.id, input.id))
        .returning();
    }),
} satisfies RouterRecord;
```

**Step 2: Create edge router**

`packages/ooda/src/api/edge-router.ts`:

```typescript
import { threadsEdgeRouter } from "./router/threads-edge";
import { runnerRouter } from "./router/runner";
import { researchRouter } from "./router/research";
import { importsRouter } from "./router/imports";
import { createTRPCRouter } from "./trpc";

export const edgeRouter = createTRPCRouter({
  threads: threadsEdgeRouter,
  runner: runnerRouter,
  research: researchRouter,
  imports: importsRouter,
});

export type EdgeRouter = typeof edgeRouter;
```

**Step 3: Export from package barrel**

Add to `packages/ooda/src/api/index.ts`:

```typescript
export { edgeRouter, type EdgeRouter } from "./edge-router";
```

Add subpath export to `packages/ooda/package.json` exports:

```json
"./api/edge": "./src/api/edge-router.ts"
```

**Step 4: Verify typecheck**

Run: `cd packages/ooda && pnpm typecheck`

**Step 5: Commit**

```bash
git add packages/ooda/
git commit -m "feat(ooda): add edge router excluding filesystem-dependent routes"
```

---

## Task 6: OODA Auth Migration — better-auth

**Files:**
- Modify: `packages/ooda/src/api/trpc.ts`
- Modify: `packages/ooda/package.json` (add better-auth dep if missing)
- Delete: `packages/ooda/src/db/auth.ts`

**What:** Replace OODA's manual session validation with better-auth's `getSession()`. The tRPC context now accepts an auth instance and uses it for session resolution. `runnerProcedure` stays unchanged (bearer token for runner secret).

**Step 1: Update createTRPCContext**

Change `trpc.ts` to accept an auth instance:

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z, ZodError } from "zod";
import type { AuthInstance } from "@gmacko/core/auth";

import { db } from "@gmacko/ooda/db/client";

export const createTRPCContext = async (opts: {
  headers: Headers;
  auth?: AuthInstance;
}) => {
  return { db, headers: opts.headers, auth: opts.auth };
};
```

**Step 2: Replace authedProcedure**

Replace the manual `validateSessionToken` + `extractSessionToken` with `auth.api.getSession()`:

```typescript
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Auth not configured",
    });
  }

  const session = await ctx.auth.api.getSession({
    headers: ctx.headers,
  });

  if (!session?.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Not authenticated",
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: session.user.id,
      email: session.user.email,
      session,
    },
  });
});
```

**Step 3: Remove old auth imports**

Remove the imports of `validateSessionToken`, `extractSessionToken`, `SessionNotFoundError` from trpc.ts.

**Step 4: Delete packages/ooda/src/db/auth.ts**

Remove the file. Update any barrel exports that reference it (check `packages/ooda/src/db/index.ts` or package.json exports).

**Step 5: Update tRPC route handler in apps/ooda**

Update `apps/ooda/src/app/api/trpc/[trpc]/route.ts` to pass the auth instance:

```typescript
import { initAuth } from "@gmacko/core/auth";
import { db } from "@gmacko/ooda/db/client";

const auth = initAuth({
  db,
  pluralizeTables: true,
  baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  productionUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
});

const handler = async (req: NextRequest) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers, auth }),
    ...
  });
};
```

**Step 6: Update middleware.ts**

OODA's middleware still needs to check for session presence on protected routes. Update to also accept the better-auth cookie:

The existing middleware already checks `better-auth.session_token` cookie — no change needed.

**Step 7: Verify tests pass**

Run: `pnpm exec turbo run test --filter=@gmacko/ooda -- --no-file-parallelism`

**Step 8: Commit**

```bash
git add packages/ooda/ apps/ooda/
git commit -m "feat(ooda): migrate auth to better-auth, remove manual session validation"
```

---

## Task 7: OODA Vinext Port — App Shell

**Files:**
- Create: `apps/ooda-edge/package.json`
- Create: `apps/ooda-edge/tsconfig.json`
- Create: `apps/ooda-edge/vite.config.ts`
- Create: `apps/ooda-edge/wrangler.jsonc`
- Create: `apps/ooda-edge/postcss.config.mjs`
- Create: `apps/ooda-edge/src/lib/db-client-lazy.ts`
- Create: `apps/ooda-edge/src/lib/fs-stub.ts`
- Create: `apps/ooda-edge/src/lib/os-stub.ts`
- Create: `apps/ooda-edge/src/lib/pg-native-stub.ts`
- Create: `apps/ooda-edge/src/auth/server.ts`
- Create: `apps/ooda-edge/src/app/globals.css`
- Create: `apps/ooda-edge/src/app/layout.tsx`

**What:** Create the Vinext-based OODA app for CF Workers. This is a new app alongside the existing Next.js app (which stays for local dev). The edge app uses the edge router, Hyperdrive DB client, and shared auth.

We keep both `apps/ooda` (Next.js, local dev) and `apps/ooda-edge` (Vinext, CF Workers) because the Next.js app has the full router with filesystem-dependent routes that only work locally. Once Phase 3 wires filesystem routes through the runner, we can consider merging them.

**Step 1: Create package.json**

```json
{
  "name": "@gmacko/ooda-edge",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "vinext dev --port 3002",
    "build": "vinext build",
    "start": "vinext start",
    "deploy": "vinext deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gmacko/core": "workspace:*",
    "@gmacko/ooda": "workspace:*",
    "@tanstack/react-query": "^5.91.0",
    "@trpc/client": "catalog:",
    "@trpc/server": "catalog:",
    "@trpc/tanstack-react-query": "catalog:",
    "better-auth": "catalog:",
    "drizzle-orm": "catalog:",
    "postgres": "catalog:",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "reagraph": "^4.30.8",
    "superjson": "^2.2.0",
    "vinext": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "catalog:",
    "@gmacko/tailwind": "workspace:*",
    "@gmacko/tsconfig": "workspace:*",
    "@tailwindcss/postcss": "^4.2.0",
    "@types/node": "25.6.0",
    "@types/react": "19.2.14",
    "tailwindcss": "catalog:",
    "typescript": "^5.9.0",
    "wrangler": "catalog:"
  }
}
```

**Step 2: Create vite.config.ts**

```typescript
import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;

export default defineConfig({
  plugins: [
    vinext(),
    ...(!isDev
      ? [
          cloudflare({
            viteEnvironment: {
              name: "rsc",
              childEnvironments: ["ssr"],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
      "@gmacko/ooda/db/client": path.resolve(
        __dirname,
        "src/lib/db-client-lazy.ts",
      ),
      "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
      "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
      "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
    },
  },
  ssr: {
    noExternal: [/^@gmacko\//, "postgres", "drizzle-orm"],
    external: [
      "pg",
      "pg-native",
      "pg-pool",
      "@electric-sql/pglite",
      "drizzle-kit",
    ],
  },
});
```

**Step 3: Create wrangler.jsonc**

```jsonc
{
  "name": "ooda-blder-bot",
  "main": "./worker/index.js",
  "compatibility_date": "2025-12-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "routes": [{ "pattern": "ooda.blder.bot", "custom_domain": true }],
  "assets": {
    "directory": "dist/client",
    "binding": "ASSETS",
    "not_found_handling": "none"
  },
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "c1f467f772dc4ce99d99e572df74c121"
    }
  ],
  "vars": {
    "REQUIRE_AUTH": "true",
    "FRONTEND_URL": "https://ooda.blder.bot",
    "NODE_ENV": "production"
  }
}
```

**Step 4: Create DB client, Node stubs, auth server**

- `db-client-lazy.ts` — same pattern as Bob's, import `@gmacko/ooda/db/schema`
- `fs-stub.ts`, `os-stub.ts`, `pg-native-stub.ts` — copy from Bob
- `auth/server.ts` — create auth instance with `cookieDomain: ".blder.bot"`, `baseUrl: "https://blder.bot"` (auth lives at platform app, not ooda subdomain)

```typescript
import { initAuth } from "@gmacko/core/auth";
import { db } from "~/lib/db-client-lazy";

const authBaseUrl = process.env.AUTH_BASE_URL ?? "https://blder.bot";

export const auth = initAuth({
  db,
  pluralizeTables: true,
  baseUrl: authBaseUrl,
  productionUrl: authBaseUrl,
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  trustedOrigins: [
    "https://blder.bot",
    "https://bob.blder.bot",
    process.env.FRONTEND_URL ?? "https://ooda.blder.bot",
  ],
  cookieDomain: ".blder.bot",
});
```

**Step 5: Create layout**

Port from `apps/ooda/src/app/layout.tsx`. Changes:
- Replace `next/font/google` with Google Fonts CDN `<link>` in `<head>`
- Replace Next.js `Metadata`/`Viewport` exports with `<head>` tags
- Keep ThemeProvider, TRPCReactProvider, AppShell wrapping

**Step 6: Create postcss.config.mjs and globals.css**

Same as OODA's existing files.

**Step 7: Install and verify**

Run: `pnpm install && cd apps/ooda-edge && pnpm typecheck`

**Step 8: Commit**

```bash
git add apps/ooda-edge/
git commit -m "feat(ooda-edge): scaffold Vinext app for ooda.blder.bot"
```

---

## Task 8: OODA Vinext Port — tRPC + Pages

**Files:**
- Create: `apps/ooda-edge/src/trpc/react.tsx`
- Create: `apps/ooda-edge/src/trpc/query-client.ts`
- Create: `apps/ooda-edge/src/app/api/trpc/[trpc]/route.ts`
- Copy all pages from `apps/ooda/src/app/` to `apps/ooda-edge/src/app/`
- Copy all components from `apps/ooda/src/components/` to `apps/ooda-edge/src/components/`
- Copy all hooks from `apps/ooda/src/hooks/` to `apps/ooda-edge/src/hooks/`
- Create: `apps/ooda-edge/src/middleware.ts`

**What:** Wire tRPC client and server into the Vinext app. Port all pages and components. Pages are all `"use client"` so the port is mostly mechanical — replace `next/navigation` imports with vinext equivalents, remove RSC-specific code.

**Step 1: Create tRPC client (react.tsx)**

Port from `apps/ooda/src/trpc/react.tsx`. Changes:
- Use `EdgeRouter` type instead of `AppRouter`
- Update `getBaseUrl()` to use `FRONTEND_URL` env var instead of `VERCEL_URL`

```typescript
import type { EdgeRouter } from "@gmacko/ooda/api";
// ... rest same as apps/ooda/src/trpc/react.tsx but typed against EdgeRouter

const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  return "http://localhost:3002";
};
```

**Step 2: Create query-client.ts**

Copy from `apps/ooda/src/trpc/query-client.ts` unchanged.

**Step 3: Create tRPC route handler**

```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { edgeRouter, createTRPCContext } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";

const handler = async (req: Request) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: edgeRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers, auth }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error.message);
    },
  });
};

export { handler as GET, handler as POST };
```

**Step 4: Remove RSC server hook**

The Vinext app does NOT need `apps/ooda/src/trpc/server.tsx` — no RSC data loading (all pages are `"use client"`). Skip this file.

**Step 5: Copy pages**

Copy all page files from `apps/ooda/src/app/` to `apps/ooda-edge/src/app/`. The key changes per file:
- `page.tsx` (home) — replace `next/link` with vinext's `<a>` or router link
- `capture/page.tsx` — should work as-is (client component)
- `health/page.tsx` — should work as-is
- `research/page.tsx` + `_components/` — should work as-is
- `threads/page.tsx` — should work as-is
- `threads/[threadId]/page.tsx` — replace `useParams()` from `next/navigation` with vinext equivalent
- `threads/[threadId]/research/page.tsx` — same
- `threads/layout.tsx` — should work as-is

**Step 6: Copy components**

Copy `apps/ooda/src/components/` to `apps/ooda-edge/src/components/`. Changes:
- `command-palette.tsx` — replace `useRouter()` from `next/navigation` with vinext
- `app-shell.tsx` — replace `next/link` with vinext equivalent
- Other components should work unchanged

**Step 7: Copy hooks**

Copy `apps/ooda/src/hooks/` unchanged.

**Step 8: Create middleware**

Port from `apps/ooda/src/middleware.ts`. Vinext may handle middleware differently — adapt to vinext's middleware pattern if needed. The core logic is the same: check for session cookie on protected routes.

**Step 9: Verify build**

Run: `cd apps/ooda-edge && pnpm build`

Fix any import issues (next/navigation → vinext, next/link → vinext link, etc.).

**Step 10: Commit**

```bash
git add apps/ooda-edge/
git commit -m "feat(ooda-edge): port pages, components, and tRPC to Vinext"
```

---

## Task 9: Bob Subdomain Migration

**Files:**
- Modify: `apps/bob/wrangler.jsonc`
- Modify: `apps/bob/src/auth/server.ts`

**What:** Move Bob from `blder.bot` to `bob.blder.bot`. Update wrangler route and auth config to use shared cookie domain. Auth routes stay in Bob for now (they'll be removed once the platform app is handling all auth in production).

**Step 1: Update wrangler.jsonc**

Change the route pattern:

```jsonc
"routes": [{ "pattern": "bob.blder.bot", "custom_domain": true }],
```

Update `FRONTEND_URL`:

```jsonc
"vars": {
  "FRONTEND_URL": "https://bob.blder.bot",
  ...
}
```

**Step 2: Update auth config**

In `apps/bob/src/auth/server.ts`, add `cookieDomain` and update `trustedOrigins`:

The `createAuthRuntime` call needs the `cookieDomain` option from Task 1. Update the call:

```typescript
export const authBundle: AuthRuntimeBundle = createAuthRuntime({
  ...existing opts,
  trustedOrigins: [
    "https://blder.bot",
    "https://ooda.blder.bot",
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
  ],
});
```

Note: `cookieDomain` needs to be threaded through `createAuthRuntime` → `initAuth`. Update `AuthRuntimeOptions` in `packages/bob/src/auth/src/runtime.ts` to accept and forward `cookieDomain`.

**Step 3: Verify build**

Run: `cd apps/bob && pnpm build`

**Step 4: Commit**

```bash
git add apps/bob/ packages/bob/
git commit -m "feat(bob): migrate to bob.blder.bot subdomain with shared cookie domain"
```

---

## Task 10: DNS + Secrets Setup

**Files:**
- No code changes — infrastructure setup

**What:** Set up DNS records, Hyperdrive, and secrets for all three apps.

**Step 1: DNS records**

Verify Cloudflare DNS has:
- `blder.bot` → CF Workers (already exists, will be repointed by wrangler deploy)
- `bob.blder.bot` → CF Workers (new CNAME)
- `ooda.blder.bot` → CF Workers (new CNAME)

Wrangler's `custom_domain: true` handles this automatically on deploy.

**Step 2: Set secrets for blder-bot-platform**

```bash
cd apps/blder
echo "<value>" | wrangler secret put AUTH_SECRET
echo "<value>" | wrangler secret put AUTH_GITHUB_ID
echo "<value>" | wrangler secret put AUTH_GITHUB_SECRET
```

**Step 3: Set secrets for ooda-blder-bot**

```bash
cd apps/ooda-edge
echo "<value>" | wrangler secret put AUTH_SECRET
echo "<value>" | wrangler secret put AUTH_GITHUB_ID
echo "<value>" | wrangler secret put AUTH_GITHUB_SECRET
echo "<value>" | wrangler secret put OODA_RUNNER_SECRET
```

**Step 4: Verify Hyperdrive binding**

All three apps use the same Hyperdrive config ID (`c1f467f772dc4ce99d99e572df74c121`). Verify it's still active and pointing to Hetzner Postgres.

**Step 5: Document in CLAUDE.md**

Add the three-app architecture to the project CLAUDE.md.

---

## Task 11: Deploy + Smoke Test

**What:** Deploy all three apps and verify the auth flow works end-to-end.

**Step 1: Deploy platform app**

```bash
cd apps/blder && pnpm deploy
```

**Step 2: Deploy OODA edge**

```bash
cd apps/ooda-edge && pnpm deploy
```

**Step 3: Deploy Bob (subdomain)**

```bash
cd apps/bob && pnpm deploy
```

**Step 4: Smoke test auth flow**

1. Visit `ooda.blder.bot` — should redirect to `blder.bot/login`
2. Sign in with GitHub — callback returns to `blder.bot`
3. Visit `ooda.blder.bot` — should be authenticated (shared cookie)
4. Visit `bob.blder.bot` — should also be authenticated
5. Verify tRPC calls work on both subdomains

**Step 5: Commit any fixes**

Fix any issues discovered during smoke testing.

---

## Task 12: Cleanup + Final Verification

**What:** Run full test suite, verify typecheck across all packages, clean up any loose ends.

**Step 1: Run tests**

```bash
pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism
```

**Step 2: Typecheck all packages**

```bash
pnpm exec turbo run typecheck
```

**Step 3: Verify OpenAPI spec generation still works**

```bash
pnpm exec tsx scripts/generate-openapi.ts
```

The edge router should also generate a valid spec (subset of the full spec).

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: phase 10 cleanup and verification"
```

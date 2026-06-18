# Phase 2: Backend, UI Wiring, Agent Integration, Wiki Output

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the full backend API, wire up web + mobile to it, add branching interactions, agent dispatch with streaming, and wiki output to the Obsidian vault.

**Architecture:** tRPC 11 backend with Drizzle ORM + PostgreSQL. Web and mobile consume the same API. Agent dispatch sends prompts to Claude API, streams responses back via tRPC subscriptions. Wiki articles are markdown files written to a configurable vault directory with wikilinks and frontmatter.

**Tech Stack:** tRPC 11, Drizzle ORM, PostgreSQL (Docker), Zod 4, SuperJSON, Anthropic SDK, gray-matter, React Query, NativeWind

---

## Phase 2A: Database + API

### Task 12: Create @gmacko/db package with Drizzle schema

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/threads.ts`
- Create: `packages/db/src/schema/messages.ts`
- Create: `packages/db/src/schema/branches.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `docker-compose.yml` (root)

**Step 1: Create package.json**

```json
{
  "name": "@gmacko/db",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts",
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "postgres": "^3.4.0",
    "zod": "^4.0.0",
    "drizzle-zod": "^0.7.0"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.9.0"
  }
}
```

**Step 2: Create schema files**

```ts
// packages/db/src/schema/threads.ts
import { pgTable, pgEnum, uuid, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const threadStatusEnum = pgEnum("thread_status", [
  "active", "paused", "archived", "completed",
]);

export const thread = pgTable("thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 256 }).notNull(),
  status: threadStatusEnum("status").default("active").notNull(),
  activeBranchId: uuid("active_branch_id"),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const CreateThreadSchema = createInsertSchema(thread, {
  title: z.string().min(1).max(256),
}).omit({ id: true, createdAt: true, updatedAt: true, activeBranchId: true });

export const UpdateThreadStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "paused", "archived", "completed"]),
});
```

```ts
// packages/db/src/schema/branches.ts
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { thread } from "./threads";

export const branch = pgTable("branch", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
  parentBranchId: uuid("parent_branch_id"),
  forkPointMessageId: uuid("fork_point_message_id"),
  name: varchar("name", { length: 256 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

```ts
// packages/db/src/schema/messages.ts
import { pgTable, pgEnum, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { thread } from "./threads";
import { branch } from "./branches";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const message = pgTable("message", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").notNull().references(() => branch.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

```ts
// packages/db/src/schema/index.ts
export * from "./threads";
export * from "./branches";
export * from "./messages";
```

```ts
// packages/db/src/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://gmacko:gmacko@localhost:5432/gmacko";
const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });
export type Database = typeof db;
```

```ts
// packages/db/src/index.ts
export { db, type Database } from "./client";
export * from "./schema";
```

```ts
// packages/db/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://gmacko:gmacko@localhost:5432/gmacko",
  },
});
```

```yaml
# docker-compose.yml (root)
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: gmacko
      POSTGRES_PASSWORD: gmacko
      POSTGRES_DB: gmacko
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

**Step 3: Install and generate migrations**

```bash
cd ~/gmacko && pnpm install
docker compose up -d postgres
cd packages/db && pnpm db:push
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add @gmacko/db with Drizzle schema for threads, branches, messages"
```

---

### Task 13: Create @gmacko/api package with tRPC routers

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/index.ts`
- Create: `packages/api/src/trpc.ts`
- Create: `packages/api/src/root.ts`
- Create: `packages/api/src/routers/threads.ts`
- Create: `packages/api/src/routers/branches.ts`
- Create: `packages/api/src/routers/messages.ts`
- Test: `packages/api/src/__tests__/threads.test.ts`

**Step 1: Create package.json**

```json
{
  "name": "@gmacko/api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@gmacko/db": "workspace:*",
    "@trpc/server": "^11.0.0",
    "superjson": "^2.2.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tRPC setup**

```ts
// packages/api/src/trpc.ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Database } from "@gmacko/db";

export interface TRPCContext {
  db: Database;
}

export const createTRPCContext = (db: Database): TRPCContext => ({ db });

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
```

**Step 3: Create routers**

```ts
// packages/api/src/routers/threads.ts
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { thread, branch, CreateThreadSchema, UpdateThreadStatusSchema } from "@gmacko/db";

export const threadsRouter = {
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(thread).orderBy(desc(thread.updatedAt))
  ),

  byId: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(thread).where(eq(thread.id, input.id)).then(r => r[0])
    ),

  create: publicProcedure
    .input(CreateThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const [newThread] = await ctx.db.insert(thread).values(input).returning();
      // Create default "main" branch
      await ctx.db.insert(branch).values({
        threadId: newThread.id,
        name: "Main",
      });
      // Update activeBranchId
      const [mainBranch] = await ctx.db.select().from(branch)
        .where(eq(branch.threadId, newThread.id));
      await ctx.db.update(thread)
        .set({ activeBranchId: mainBranch.id })
        .where(eq(thread.id, newThread.id));
      return { ...newThread, activeBranchId: mainBranch.id };
    }),

  updateStatus: publicProcedure
    .input(UpdateThreadStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db.update(thread)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(thread.id, input.id))
        .returning();
      return updated;
    }),
};
```

```ts
// packages/api/src/routers/branches.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { branch, thread } from "@gmacko/db";

export const branchesRouter = {
  listByThread: publicProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(branch).where(eq(branch.threadId, input.threadId))
    ),

  create: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      parentBranchId: z.string().uuid(),
      forkPointMessageId: z.string().uuid(),
      name: z.string().min(1).max(256),
    }))
    .mutation(async ({ ctx, input }) => {
      const [newBranch] = await ctx.db.insert(branch).values(input).returning();
      return newBranch;
    }),

  setActive: publicProcedure
    .input(z.object({ threadId: z.string().uuid(), branchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(thread)
        .set({ activeBranchId: input.branchId, updatedAt: new Date() })
        .where(eq(thread.id, input.threadId));
    }),
};
```

```ts
// packages/api/src/routers/messages.ts
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { message } from "@gmacko/db";

export const messagesRouter = {
  listByBranch: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      branchId: z.string().uuid(),
    }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(message)
        .where(and(
          eq(message.threadId, input.threadId),
          eq(message.branchId, input.branchId),
        ))
        .orderBy(asc(message.createdAt))
    ),

  create: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      branchId: z.string().uuid(),
      parentId: z.string().uuid().nullable(),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().min(1),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [msg] = await ctx.db.insert(message).values(input).returning();
      return msg;
    }),
};
```

```ts
// packages/api/src/root.ts
import { createTRPCRouter } from "./trpc";
import { threadsRouter } from "./routers/threads";
import { branchesRouter } from "./routers/branches";
import { messagesRouter } from "./routers/messages";

export const appRouter = createTRPCRouter({
  threads: threadsRouter,
  branches: branchesRouter,
  messages: messagesRouter,
});

export type AppRouter = typeof appRouter;
```

```ts
// packages/api/src/index.ts
export { appRouter, type AppRouter } from "./root";
export { createTRPCContext, type TRPCContext } from "./trpc";
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add @gmacko/api with tRPC routers for threads, branches, messages"
```

---

### Task 14: Wire tRPC into Next.js web app

**Files:**
- Create: `apps/web/src/trpc/react.tsx`
- Create: `apps/web/src/trpc/server.ts`
- Create: `apps/web/src/app/api/trpc/[...trpc]/route.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/package.json`

**Step 1: Add API deps to web app**

Add to apps/web/package.json dependencies:
```json
"@gmacko/api": "workspace:*",
"@gmacko/db": "workspace:*",
"@trpc/client": "^11.0.0",
"@trpc/server": "^11.0.0",
"@trpc/tanstack-react-query": "^11.0.0",
"@tanstack/react-query": "^5.91.0",
"superjson": "^2.2.0"
```

**Step 2: Create tRPC client**

```tsx
// apps/web/src/trpc/react.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "@gmacko/api";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return "http://localhost:3000";
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: createTRPCClient({
    links: [
      httpBatchStreamLink({
        transformer: superjson,
        url: `${getBaseUrl()}/api/trpc`,
      }),
    ],
  }),
  queryClient: getQueryClient(),
});

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

**Step 3: Create API route handler**

```ts
// apps/web/src/app/api/trpc/[...trpc]/route.ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@gmacko/api";
import { db } from "@gmacko/db";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext(db),
  });

export { handler as GET, handler as POST };
```

**Step 4: Update layout with TRPCProvider**

Wrap the app in TRPCProvider in layout.tsx.

**Step 5: Update page.tsx to use real data**

Replace mock useState with tRPC queries:
- `trpc.threads.list.useQuery()` for thread list
- `trpc.messages.listByBranch.useQuery()` for messages
- `trpc.messages.create.useMutation()` for sending
- `trpc.threads.create.useMutation()` for new threads
- `trpc.branches.listByThread.useQuery()` for branch tree

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire tRPC into Next.js with API routes and React client"
```

---

## Phase 2B: Interactive Branching

### Task 15: Add branch creation UI to web app

**Files:**
- Create: `packages/ui/src/branch-tree/create-branch-dialog.tsx`
- Modify: `packages/ui/src/branch-tree/branch-tree.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Step 1: Add "Fork here" action to messages**

Add a fork button on each assistant message. When clicked, it:
1. Opens a dialog to name the new branch
2. Calls `branches.create` with the forkPointMessageId
3. Switches to the new branch
4. Shows messages up to the fork point + new conversation

**Step 2: Update BranchTree to show create button**

Add a "+" button in the branch tree sidebar to create a new branch from the current position.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add branch creation from messages with fork dialog"
```

---

### Task 16: Add theme switcher to web app

**Files:**
- Create: `packages/ui/src/theme-switcher.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Create ThemeSwitcher component**

A dropdown or toggle that switches between "ooda" and "bob" themes. Persists choice to localStorage.

**Step 2: Add to app header/shell**

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add theme switcher with localStorage persistence"
```

---

## Phase 2C: Agent Integration

### Task 17: Create @gmacko/agent package

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/src/index.ts`
- Create: `packages/agent/src/dispatch.ts`
- Create: `packages/agent/src/stream.ts`

**Step 1: Create agent dispatch service**

```ts
// packages/agent/src/dispatch.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface DispatchOptions {
  threadId: string;
  branchId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt?: string;
}

export async function* dispatchAgent(opts: DispatchOptions) {
  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: opts.systemPrompt ?? "You are a research assistant. Help the user explore ideas, find connections, and build understanding.",
    messages: opts.messages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text" as const, text: event.delta.text };
    }
  }

  const finalMessage = await stream.finalMessage();
  yield {
    type: "done" as const,
    content: finalMessage.content.map(c => c.type === "text" ? c.text : "").join(""),
    usage: finalMessage.usage,
  };
}
```

**Step 2: Create package.json**

```json
{
  "name": "@gmacko/agent",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "typescript": "^5.9.0"
  }
}
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add @gmacko/agent with Claude streaming dispatch"
```

---

### Task 18: Add agent chat endpoint to API

**Files:**
- Create: `packages/api/src/routers/agent.ts`
- Modify: `packages/api/src/root.ts`
- Modify: `apps/web/src/app/page.tsx`

**Step 1: Add agent.chat mutation**

The agent router exposes a `chat` mutation that:
1. Takes threadId, branchId, user message content
2. Saves user message to DB
3. Loads conversation history from DB
4. Calls dispatchAgent with history
5. Streams response chunks back
6. Saves final assistant message to DB
7. Returns the assistant message

For streaming, use a standard mutation that returns the full response (streaming UI comes from optimistic updates + polling initially, or SSE later).

**Step 2: Update web app to call agent.chat on send**

When user sends a message:
1. Optimistically add user message to UI
2. Call `agent.chat` mutation
3. When response arrives, add assistant message to UI

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add agent chat endpoint with Claude integration"
```

---

## Phase 2D: Wiki Output

### Task 19: Create @gmacko/wiki package

**Files:**
- Create: `packages/wiki/package.json`
- Create: `packages/wiki/src/index.ts`
- Create: `packages/wiki/src/writer.ts`
- Create: `packages/wiki/src/linker.ts`
- Test: `packages/wiki/src/__tests__/writer.test.ts`
- Test: `packages/wiki/src/__tests__/linker.test.ts`

**Step 1: Create wiki writer**

```ts
// packages/wiki/src/writer.ts
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import matter from "gray-matter";

export interface WikiArticle {
  title: string;
  slug: string;
  content: string;
  tags: string[];
  sourceThreadId: string;
  sourceBranchIds: string[];
  relatedArticles: string[]; // wikilink slugs
}

export async function writeArticle(vaultPath: string, article: WikiArticle): Promise<string> {
  const filePath = join(vaultPath, "wiki", `${article.slug}.md`);
  await mkdir(dirname(filePath), { recursive: true });

  const frontmatter = {
    title: article.title,
    tags: article.tags,
    created: new Date().toISOString(),
    source_thread: article.sourceThreadId,
    source_branches: article.sourceBranchIds,
  };

  // Add wikilinks to related articles
  const wikilinks = article.relatedArticles
    .map(slug => `- [[${slug}]]`)
    .join("\n");

  const body = `${article.content}\n\n## Related\n\n${wikilinks}\n`;
  const output = matter.stringify(body, frontmatter);

  await writeFile(filePath, output, "utf-8");
  return filePath;
}
```

**Step 2: Create cross-linker**

```ts
// packages/wiki/src/linker.ts
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";

export interface WikiIndex {
  slug: string;
  title: string;
  tags: string[];
  outboundLinks: string[]; // slugs this article links to
}

export async function buildIndex(vaultPath: string): Promise<WikiIndex[]> {
  const wikiDir = join(vaultPath, "wiki");
  const files = await readdir(wikiDir).catch(() => []);

  const index: WikiIndex[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(wikiDir, file), "utf-8");
    const { data, content: body } = matter(content);

    const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
    index.push({
      slug: file.replace(".md", ""),
      title: data.title ?? file.replace(".md", ""),
      tags: data.tags ?? [],
      outboundLinks: links,
    });
  }
  return index;
}

export function findOrphanedArticles(index: WikiIndex[]): string[] {
  const allLinkedSlugs = new Set(index.flatMap(a => a.outboundLinks));
  return index
    .filter(a => !allLinkedSlugs.has(a.slug))
    .map(a => a.slug);
}
```

**Step 3: Write tests for writer and linker**

Test that writeArticle creates a file with correct frontmatter and wikilinks.
Test that buildIndex finds all articles and their links.
Test that findOrphanedArticles identifies unlinked articles.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add @gmacko/wiki with article writer, cross-linker, and index builder"
```

---

### Task 20: Add wiki router to API

**Files:**
- Create: `packages/api/src/routers/wiki.ts`
- Modify: `packages/api/src/root.ts`

**Step 1: Create wiki router**

```ts
// packages/api/src/routers/wiki.ts
export const wikiRouter = {
  // "Write this up" — synthesize thread conversation into wiki article
  synthesize: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      branchId: z.string().uuid(),
      title: z.string().min(1),
      tags: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Load messages from branch
      // 2. Send to Claude with synthesis prompt
      // 3. Write article to vault
      // 4. Return article path
    }),

  // List all wiki articles
  list: publicProcedure.query(async () => {
    // Build index from vault directory
  }),

  // Find orphaned articles (no inbound links)
  orphans: publicProcedure.query(async () => {
    // Use findOrphanedArticles
  }),
};
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add wiki router with synthesis, listing, and orphan detection"
```

---

## Phase 2E: Mobile Wiring

### Task 21: Wire tRPC into mobile app

**Files:**
- Create: `apps/mobile/src/utils/api.tsx`
- Create: `apps/mobile/src/utils/base-url.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/mobile/src/app/index.tsx`
- Modify: `apps/mobile/src/app/thread/[id].tsx`
- Modify: `apps/mobile/package.json`

**Step 1: Add tRPC deps to mobile**

Add @gmacko/api, @trpc/client, @trpc/tanstack-react-query, superjson to mobile deps.

**Step 2: Create tRPC client for mobile**

Same pattern as Bob's api.tsx — httpBatchLink with SuperJSON, base URL from env.

**Step 3: Replace mock data with tRPC queries**

Thread list screen: `trpc.threads.list.useQuery()`
Thread detail: `trpc.messages.listByBranch.useQuery()` + `trpc.messages.create.useMutation()`

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: wire tRPC into mobile app with live data"
```

---

### Task 22: Add tablet pane components for mobile

**Files:**
- Create: `apps/mobile/src/components/tablet/ThreadSidebar.tsx`
- Create: `apps/mobile/src/components/tablet/ThreadPane.tsx`
- Create: `apps/mobile/src/components/tablet/WikiPane.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`

**Step 1: Create ThreadSidebar**

Shows list of threads with status badges, connection state indicator, pull-to-refresh. Adapted from Bob's TabletSidebar.

**Step 2: Create ThreadPane**

Chat view for active thread — messages list with branch indicator, composer, "write this up" action button. Adapted from Bob's PlanningPane.

**Step 3: Create WikiPane**

Displays wiki article content as rendered markdown. Shows related articles as tappable wikilinks. Adapted from Bob's InspectorPanel concept.

**Step 4: Wire into TabletLayout**

SplitView left column: ThreadSidebar
SplitView right column: ThreadPane or WikiPane based on selection

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add tablet pane components for iPad SplitView"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 2A | 12-14 | Database, tRPC API, web app wiring |
| 2B | 15-16 | Branch creation UI, theme switcher |
| 2C | 17-18 | Claude agent integration with streaming |
| 2D | 19-20 | Wiki article writer, cross-linker, synthesis |
| 2E | 21-22 | Mobile tRPC wiring, tablet pane components |

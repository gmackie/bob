# Cookie Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable agents to use the user's real browser cookies for authenticated Playwright browsing and HTTP requests, imported via browser extension or CLI.

**Architecture:** Two ingestion paths (browser extension + CLI) write to a shared encrypted `browserCookies` table via `POST /api/cookies/import`. Agent sessions consume cookies through a `get_cookies` gateway tool, scoped per-session by domain. Encryption reuses the existing AES-256-GCM tokenVault pattern.

**Tech Stack:** Drizzle ORM (PostgreSQL), tRPC, Next.js API routes, Manifest V3 browser extension, Node.js crypto, Playwright cookie API.

**Design doc:** `docs/plans/2026-03-28-cookie-bridge-design.md`

---

## Task 1: Database Schema — `browserCookies` table

**Files:**
- Modify: `packages/db/src/schema.ts` (add table after `gitProviderConnections` ~line 1376)

**Step 1: Add the browserCookies table definition**

Add this after the `gitProviderConnections` block (around line 1376) in `packages/db/src/schema.ts`:

```typescript
// ── Browser Cookie Jar ─────────────────────────────────────────────

export const cookieSourceEnum = ["extension", "cli"] as const;
export const sameSiteEnum = ["Strict", "Lax", "None"] as const;

export const browserCookies = pgTable(
  "browser_cookies",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    name: t.text().notNull(),
    valueCiphertext: t.text().notNull(),
    valueIv: t.text().notNull(),
    valueTag: t.text().notNull(),
    path: t.text().notNull().default("/"),
    expires: t.timestamp({ mode: "date", withTimezone: true }),
    secure: t.boolean().notNull().default(false),
    httpOnly: t.boolean().notNull().default(false),
    sameSite: t.varchar({ length: 10 }).notNull().default("Lax"),
    source: t.varchar({ length: 20 }).notNull(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("browser_cookies_user_domain_name_path_idx").on(
      table.userId,
      table.domain,
      table.name,
      table.path,
    ),
    index("browser_cookies_user_domain_idx").on(table.userId, table.domain),
  ],
);

export const browserCookiesRelations = relations(browserCookies, ({ one }) => ({
  user: one(user, {
    fields: [browserCookies.userId],
    references: [user.id],
  }),
}));
```

**Step 2: Add the sessionCookieScopes table**

Add immediately after `browserCookies`:

```typescript
export const sessionCookieScopes = pgTable(
  "session_cookie_scopes",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("session_cookie_scopes_session_domain_idx").on(
      table.sessionId,
      table.domain,
    ),
  ],
);

export const sessionCookieScopesRelations = relations(
  sessionCookieScopes,
  ({ one }) => ({
    session: one(chatConversations, {
      fields: [sessionCookieScopes.sessionId],
      references: [chatConversations.id],
    }),
  }),
);
```

**Step 3: Push schema to database**

Run: `cd /Volumes/dev/bob && pnpm -F @bob/db push`

Expected: Tables `browser_cookies` and `session_cookie_scopes` created successfully.

**Step 4: Verify with Drizzle Studio**

Run: `cd /Volumes/dev/bob && pnpm -F @bob/db studio`

Check that both tables exist with correct columns.

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add browserCookies and sessionCookieScopes tables"
```

---

## Task 2: Cookie Vault — Encrypt/Decrypt Service

**Files:**
- Create: `packages/api/src/services/crypto/cookieVault.ts`

**Step 1: Create the cookie vault service**

This reuses the tokenVault pattern but with a separate env var (`COOKIE_ENCRYPTION_KEY`) and cookie-specific helpers. Create `packages/api/src/services/crypto/cookieVault.ts`:

```typescript
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getMasterKey(): Buffer {
  // Reuse the same master key as token vault — cookies are equally sensitive
  const key = process.env.GIT_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "GIT_TOKEN_ENCRYPTION_KEY environment variable is required for cookie encryption",
    );
  }
  if (key.length < KEY_LENGTH) {
    throw new Error(
      `GIT_TOKEN_ENCRYPTION_KEY must be at least ${KEY_LENGTH} characters`,
    );
  }
  return Buffer.from(key.slice(0, KEY_LENGTH), "utf8");
}

function deriveCookieKey(masterKey: Buffer, cookieId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(`cookie:${cookieId}`)
    .digest()
    .subarray(0, KEY_LENGTH);
}

export interface EncryptedCookieValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptCookieValue(
  plaintext: string,
  cookieId: string,
): EncryptedCookieValue {
  const masterKey = getMasterKey();
  const rowKey = deriveCookieKey(masterKey, cookieId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, rowKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptCookieValue(
  encrypted: EncryptedCookieValue,
  cookieId: string,
): string {
  const masterKey = getMasterKey();
  const rowKey = deriveCookieKey(masterKey, cookieId);

  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, rowKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
```

**Step 2: Commit**

```bash
git add packages/api/src/services/crypto/cookieVault.ts
git commit -m "feat(api): add cookieVault encryption service for browser cookies"
```

---

## Task 3: tRPC Cookie Router — Import, List, Remove

**Files:**
- Create: `packages/api/src/router/cookies.ts`
- Modify: `packages/api/src/root.ts` (register the new router)

**Step 1: Create the cookies router**

Create `packages/api/src/router/cookies.ts`:

```typescript
import { and, eq, isNull, sql, count, max } from "drizzle-orm";
import { z } from "zod";

import { browserCookies, sessionCookieScopes } from "@bob/db/schema";

import {
  encryptCookieValue,
  decryptCookieValue,
} from "../services/crypto/cookieVault";
import { apiKeyWriteProcedure, protectedProcedure } from "../trpc";

const cookieInputSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string().default("/"),
  expires: z.number().nullable().optional(),
  secure: z.boolean().default(false),
  httpOnly: z.boolean().default(false),
  sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
});

export const cookiesRouter = {
  /** Import cookies — used by both extension and CLI via API key */
  import: apiKeyWriteProcedure
    .input(
      z.object({
        cookies: z.array(cookieInputSchema).min(1).max(500),
        source: z.enum(["extension", "cli"]).default("extension"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      let imported = 0;
      const domains = new Set<string>();

      for (const cookie of input.cookies) {
        const tempId = crypto.randomUUID();
        const encrypted = encryptCookieValue(cookie.value, tempId);
        const expiresDate =
          cookie.expires && cookie.expires > 0
            ? new Date(cookie.expires * 1000)
            : null;

        await ctx.db
          .insert(browserCookies)
          .values({
            id: tempId,
            userId,
            domain: cookie.domain,
            name: cookie.name,
            valueCiphertext: encrypted.ciphertext,
            valueIv: encrypted.iv,
            valueTag: encrypted.tag,
            path: cookie.path,
            expires: expiresDate,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            source: input.source,
          })
          .onConflictDoUpdate({
            target: [
              browserCookies.userId,
              browserCookies.domain,
              browserCookies.name,
              browserCookies.path,
            ],
            set: {
              valueCiphertext: encrypted.ciphertext,
              valueIv: encrypted.iv,
              valueTag: encrypted.tag,
              expires: expiresDate,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              sameSite: cookie.sameSite,
              source: input.source,
            },
          });

        imported++;
        domains.add(cookie.domain);
      }

      return { imported, domains: [...domains] };
    }),

  /** List domains in the cookie jar with counts */
  list: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select({
        domain: browserCookies.domain,
        count: count(),
        source: browserCookies.source,
        lastUpdated: max(browserCookies.updatedAt),
      })
      .from(browserCookies)
      .where(eq(browserCookies.userId, ctx.session.user.id))
      .groupBy(browserCookies.domain, browserCookies.source);

    return results;
  }),

  /** Remove all cookies for a domain */
  remove: protectedProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(browserCookies)
        .where(
          and(
            eq(browserCookies.userId, ctx.session.user.id),
            eq(browserCookies.domain, input.domain),
          ),
        )
        .returning({ id: browserCookies.id });

      return { deleted: result.length };
    }),

  /** Get decrypted cookies for a domain — used by gateway tool */
  getForSession: apiKeyWriteProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        domain: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Check domain is in scope for this session
      const scope = await ctx.db.query.sessionCookieScopes.findFirst({
        where: and(
          eq(sessionCookieScopes.sessionId, input.sessionId),
          eq(sessionCookieScopes.domain, input.domain),
        ),
      });

      if (!scope) {
        return { cookies: [], error: `Domain "${input.domain}" not in scope for this session` };
      }

      // Get cookies, filtering expired
      const cookies = await ctx.db.query.browserCookies.findMany({
        where: and(
          eq(browserCookies.userId, ctx.session.user.id),
          eq(browserCookies.domain, input.domain),
        ),
      });

      const now = new Date();
      const decrypted = cookies
        .filter((c) => !c.expires || c.expires > now)
        .map((c) => ({
          name: c.name,
          value: decryptCookieValue(
            {
              ciphertext: c.valueCiphertext,
              iv: c.valueIv,
              tag: c.valueTag,
            },
            c.id,
          ),
          domain: c.domain,
          path: c.path,
          expires: c.expires ? Math.floor(c.expires.getTime() / 1000) : -1,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite as "Strict" | "Lax" | "None",
        }));

      return { cookies: decrypted };
    }),

  /** Set cookie scopes for a session */
  setSessionScopes: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        domains: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const values = input.domains.map((domain) => ({
        sessionId: input.sessionId,
        domain,
      }));

      await ctx.db
        .insert(sessionCookieScopes)
        .values(values)
        .onConflictDoNothing();

      return { scoped: input.domains.length };
    }),
};
```

**Step 2: Register the router**

In `packages/api/src/root.ts`, add to the `appRouterRecord`:

```typescript
import { cookiesRouter } from "./router/cookies";
```

And in the record object:

```typescript
cookies: cookiesRouter,
```

**Step 3: Verify build**

Run: `cd /Volumes/dev/bob && pnpm -F @bob/api build`

Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add packages/api/src/router/cookies.ts packages/api/src/root.ts
git commit -m "feat(api): add cookies tRPC router with import, list, remove, getForSession"
```

---

## Task 4: REST API Route — `POST /api/cookies/import`

**Files:**
- Create: `apps/web/src/app/api/cookies/import/route.ts`

**Step 1: Create the REST endpoint**

The browser extension and CLI use this REST endpoint (not tRPC). Create `apps/web/src/app/api/cookies/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

import { validateApiKey } from "@bob/auth/api-key";
import { db } from "@bob/db/client";
import { browserCookies } from "@bob/db/schema";
import { encryptCookieValue } from "@bob/api/services/crypto/cookieVault";

const cookieSchema = {
  validate(body: unknown): body is {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path?: string;
      expires?: number | null;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
    }>;
    source?: "extension" | "cli";
  } {
    if (!body || typeof body !== "object") return false;
    const b = body as Record<string, unknown>;
    return Array.isArray(b.cookies) && b.cookies.length > 0;
  },
};

export async function POST(req: NextRequest) {
  // Validate API key
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  const auth = await validateApiKey(token);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  if (!auth.permissions.includes("write") && !auth.permissions.includes("admin")) {
    return NextResponse.json({ error: "API key lacks write permission" }, { status: 403 });
  }

  // Parse body
  const body = await req.json();
  if (!cookieSchema.validate(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const source = body.source ?? "extension";
  let imported = 0;
  const domains = new Set<string>();

  for (const cookie of body.cookies) {
    const tempId = crypto.randomUUID();
    const encrypted = encryptCookieValue(cookie.value, tempId);
    const expiresDate =
      cookie.expires && cookie.expires > 0
        ? new Date(cookie.expires * 1000)
        : null;

    await db
      .insert(browserCookies)
      .values({
        id: tempId,
        userId: auth.userId,
        domain: cookie.domain,
        name: cookie.name,
        valueCiphertext: encrypted.ciphertext,
        valueIv: encrypted.iv,
        valueTag: encrypted.tag,
        path: cookie.path ?? "/",
        expires: expiresDate,
        secure: cookie.secure ?? false,
        httpOnly: cookie.httpOnly ?? false,
        sameSite: cookie.sameSite ?? "Lax",
        source,
      })
      .onConflictDoUpdate({
        target: [
          browserCookies.userId,
          browserCookies.domain,
          browserCookies.name,
          browserCookies.path,
        ],
        set: {
          valueCiphertext: encrypted.ciphertext,
          valueIv: encrypted.iv,
          valueTag: encrypted.tag,
          expires: expiresDate,
          secure: cookie.secure ?? false,
          httpOnly: cookie.httpOnly ?? false,
          sameSite: cookie.sameSite ?? "Lax",
          source,
        },
      });

    imported++;
    domains.add(cookie.domain);
  }

  return NextResponse.json({ imported, domains: [...domains] });
}
```

**Step 2: Verify build**

Run: `cd /Volumes/dev/bob && pnpm -F web build`

Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/api/cookies/import/route.ts
git commit -m "feat(web): add POST /api/cookies/import REST endpoint for extension and CLI"
```

---

## Task 5: Gateway Cookie Tool Handler

**Files:**
- Create: `apps/gateway/src/sessions/cookieToolHandler.ts`
- Modify: `apps/gateway/src/agents/agent-process-manager.ts` (wire up tool interception)

**Step 1: Create the cookie tool handler**

Create `apps/gateway/src/sessions/cookieToolHandler.ts`:

```typescript
import type { SessionActor } from "./SessionActor";

const COOKIE_TOOL_NAMES = new Set(["get_cookies"]);

export function isCookieToolCall(toolName: string): boolean {
  return COOKIE_TOOL_NAMES.has(toolName);
}

export async function handleCookieToolCall(
  actor: SessionActor,
  toolCallId: string,
  toolName: string,
  argsJson: string,
): Promise<string> {
  if (toolName !== "get_cookies") {
    return JSON.stringify({ error: `Unknown cookie tool: ${toolName}` });
  }

  const args = JSON.parse(argsJson) as { domain?: string };
  if (!args.domain) {
    return JSON.stringify({ error: "domain parameter is required" });
  }

  const bobApiUrl = process.env.BOB_API_URL ?? "http://localhost:3000";
  const bobApiKey = process.env.BOB_API_KEY;

  if (!bobApiKey) {
    return JSON.stringify({ error: "BOB_API_KEY not configured on gateway" });
  }

  // Call the tRPC endpoint to get scoped, decrypted cookies
  const url = new URL("/api/trpc/cookies.getForSession", bobApiUrl);
  url.searchParams.set(
    "input",
    JSON.stringify({
      sessionId: actor.sessionId,
      domain: args.domain,
    }),
  );

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${bobApiKey}` },
  });

  if (!response.ok) {
    return JSON.stringify({ error: `Failed to fetch cookies: ${response.status}` });
  }

  const data = (await response.json()) as {
    result: { data: { cookies: unknown[]; error?: string } };
  };

  const result = data.result.data;

  if (result.error) {
    return JSON.stringify({ error: result.error });
  }

  return JSON.stringify({
    cookies: result.cookies,
    count: result.cookies.length,
    domain: args.domain,
  });
}
```

**Step 2: Wire into agent-process-manager.ts**

In `apps/gateway/src/agents/agent-process-manager.ts`, add the import at the top:

```typescript
import { isCookieToolCall, handleCookieToolCall } from "../sessions/cookieToolHandler";
```

In the tool_call handler (around line 519), add a check before the existing tool call handling:

```typescript
case "tool_call": {
  const toolName = event.data.name as string;

  // Intercept cookie tool calls
  if (isCookieToolCall(toolName)) {
    const result = await handleCookieToolCall(
      actor,
      event.data.toolCallId as string,
      toolName,
      (event.data.arguments as string) ?? "{}",
    );
    // Send result back to agent via stdin
    // (follow the same pattern as planningToolHandler)
    actor.handleToolResult(event.data.toolCallId as string, result);
    break;
  }

  // ... existing tool call handling
}
```

> **Note to implementer:** Look at how `planningToolHandler.ts` sends tool results back to the agent via stdin. The cookie handler should follow the exact same pattern. Read `planningToolHandler.ts` and `agent-process-manager.ts` tool_call case carefully before implementing.

**Step 3: Verify build**

Run: `cd /Volumes/dev/bob && pnpm -F gateway build`

Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add apps/gateway/src/sessions/cookieToolHandler.ts apps/gateway/src/agents/agent-process-manager.ts
git commit -m "feat(gateway): add get_cookies tool handler with session scope checking"
```

---

## Task 6: Session Scoping — Wire `cookieDomains` into Session Creation

**Files:**
- Modify: `apps/gateway/src/index.ts` (session start handler, ~line 1190)
- Modify: `apps/gateway/src/ws/protocol.ts` (add cookieDomains to create_session)

**Step 1: Add cookieDomains to protocol**

In `apps/gateway/src/ws/protocol.ts`, update `ClientCreateSession`:

```typescript
export interface ClientCreateSession {
  type: "create_session";
  sessionId?: string;
  worktreeId?: string;
  repositoryId?: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  cookieDomains?: string[];  // <-- add this
}
```

**Step 2: Insert scopes on session start**

In `apps/gateway/src/index.ts`, in the `/session/start` handler (around line 1190), after the session is created in the DB and before the agent is started, add scope insertion:

```typescript
// After session DB update, before agent start
const cookieDomains = body.cookieDomains as string[] | undefined;
if (cookieDomains && cookieDomains.length > 0) {
  const bobApiUrl = process.env.BOB_API_URL ?? "http://localhost:3000";
  const bobApiKey = process.env.BOB_API_KEY;
  if (bobApiKey) {
    await fetch(`${bobApiUrl}/api/trpc/cookies.setSessionScopes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobApiKey}`,
      },
      body: JSON.stringify({
        json: { sessionId, domains: cookieDomains },
      }),
    });
  }
}
```

**Step 3: Verify build**

Run: `cd /Volumes/dev/bob && pnpm -F gateway build`

**Step 4: Commit**

```bash
git add apps/gateway/src/index.ts apps/gateway/src/ws/protocol.ts
git commit -m "feat(gateway): wire cookieDomains into session creation for scope insertion"
```

---

## Task 7: Browser Extension — Chrome Manifest V3

**Files:**
- Create: `extensions/chrome/manifest.json`
- Create: `extensions/chrome/popup.html`
- Create: `extensions/chrome/popup.js`
- Create: `extensions/chrome/options.html`
- Create: `extensions/chrome/options.js`
- Create: `extensions/chrome/icons/` (placeholder icons)

**Step 1: Create manifest.json**

Create `extensions/chrome/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Bob Cookie Bridge",
  "version": "1.0.0",
  "description": "Send browser cookies to Bob for authenticated agent sessions",
  "permissions": ["cookies", "activeTab", "storage"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "options_page": "options.html",
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Step 2: Create popup.html**

Create `extensions/chrome/popup.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 360px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      font-size: 14px;
    }
    .header {
      padding: 16px;
      border-bottom: 1px solid #262626;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 { font-size: 16px; font-weight: 600; }
    .status {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block;
    }
    .status.ok { background: #22c55e; }
    .status.err { background: #ef4444; }
    .main { padding: 16px; }
    .send-btn {
      width: 100%;
      padding: 12px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .send-btn:hover { background: #1d4ed8; }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result {
      margin-top: 12px;
      padding: 10px;
      border-radius: 6px;
      font-size: 13px;
      display: none;
    }
    .result.success { background: #052e16; color: #4ade80; display: block; }
    .result.error { background: #450a0a; color: #f87171; display: block; }
    .advanced-toggle {
      margin-top: 12px;
      font-size: 12px;
      color: #737373;
      cursor: pointer;
      user-select: none;
    }
    .advanced-toggle:hover { color: #a3a3a3; }
    .domain-picker {
      margin-top: 12px;
      max-height: 300px;
      overflow-y: auto;
      display: none;
    }
    .domain-picker.open { display: block; }
    .domain-picker input[type="text"] {
      width: 100%;
      padding: 8px;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 6px;
      color: #e5e5e5;
      font-size: 13px;
      margin-bottom: 8px;
    }
    .domain-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 13px;
    }
    .domain-item input[type="checkbox"] { accent-color: #2563eb; }
    .not-configured {
      padding: 16px;
      text-align: center;
      color: #737373;
      font-size: 13px;
    }
    .not-configured a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Bob Cookie Bridge</h1>
    <span class="status" id="status"></span>
  </div>
  <div id="not-configured" class="not-configured" style="display:none;">
    Not configured. <a href="#" id="open-options">Set up Bob URL and API key</a>
  </div>
  <div class="main" id="main" style="display:none;">
    <button class="send-btn" id="send-btn">
      Send cookies for <strong id="domain-label">...</strong> to Bob
    </button>
    <div class="result" id="result"></div>
    <div class="advanced-toggle" id="advanced-toggle">&#9662; Advanced: pick multiple domains</div>
    <div class="domain-picker" id="domain-picker">
      <input type="text" id="domain-search" placeholder="Search domains...">
      <div id="domain-list"></div>
      <button class="send-btn" id="send-selected-btn" style="margin-top:8px;">
        Send selected domains
      </button>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 3: Create popup.js**

Create `extensions/chrome/popup.js`:

```javascript
/* global chrome */

let bobUrl = "";
let bobApiKey = "";
let currentDomain = "";

async function loadConfig() {
  const config = await chrome.storage.sync.get(["bobUrl", "bobApiKey"]);
  bobUrl = config.bobUrl || "";
  bobApiKey = config.bobApiKey || "";
}

async function checkConnection() {
  const statusEl = document.getElementById("status");
  if (!bobUrl || !bobApiKey) {
    statusEl.className = "status err";
    document.getElementById("not-configured").style.display = "block";
    document.getElementById("main").style.display = "none";
    return false;
  }
  try {
    const res = await fetch(`${bobUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    statusEl.className = res.ok ? "status ok" : "status err";
    document.getElementById("not-configured").style.display = "none";
    document.getElementById("main").style.display = "block";
    return res.ok;
  } catch {
    statusEl.className = "status err";
    document.getElementById("main").style.display = "block";
    return false;
  }
}

async function getCurrentDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      return url.hostname;
    } catch { return ""; }
  }
  return "";
}

async function getCookiesForDomain(domain) {
  return chrome.cookies.getAll({ domain });
}

function formatCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expirationDate ? Math.floor(c.expirationDate) : null,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite === "strict" ? "Strict" : c.sameSite === "lax" ? "Lax" : "None",
  };
}

async function sendCookies(domains) {
  const allCookies = [];
  for (const domain of domains) {
    const raw = await getCookiesForDomain(domain);
    allCookies.push(...raw.map(formatCookie));
  }

  const res = await fetch(`${bobUrl}/api/cookies/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bobApiKey}`,
    },
    body: JSON.stringify({ cookies: allCookies, source: "extension" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

function showResult(msg, isError) {
  const el = document.getElementById("result");
  el.textContent = msg;
  el.className = `result ${isError ? "error" : "success"}`;
}

async function loadAllDomains() {
  const all = await chrome.cookies.getAll({});
  const domainCounts = {};
  for (const c of all) {
    const d = c.domain.replace(/^\./, "");
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }
  return Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));
}

function renderDomainList(domains, filter) {
  const list = document.getElementById("domain-list");
  const filtered = filter
    ? domains.filter((d) => d.domain.includes(filter))
    : domains;

  list.innerHTML = filtered
    .map(
      (d) =>
        `<label class="domain-item">
          <input type="checkbox" value="${d.domain}">
          ${d.domain} <span style="color:#737373">(${d.count})</span>
        </label>`,
    )
    .join("");
}

// Init
(async () => {
  await loadConfig();
  await checkConnection();

  currentDomain = await getCurrentDomain();
  document.getElementById("domain-label").textContent = currentDomain || "this site";

  // Send current domain
  document.getElementById("send-btn").addEventListener("click", async () => {
    if (!currentDomain) return;
    const btn = document.getElementById("send-btn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const result = await sendCookies([currentDomain]);
      showResult(`Sent ${result.imported} cookies for ${currentDomain}`, false);
    } catch (e) {
      showResult(e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `Send cookies for <strong>${currentDomain}</strong> to Bob`;
    }
  });

  // Advanced toggle
  let allDomains = [];
  document.getElementById("advanced-toggle").addEventListener("click", async () => {
    const picker = document.getElementById("domain-picker");
    const isOpen = picker.classList.toggle("open");
    if (isOpen && allDomains.length === 0) {
      allDomains = await loadAllDomains();
      renderDomainList(allDomains, "");
    }
  });

  // Search filter
  document.getElementById("domain-search").addEventListener("input", (e) => {
    renderDomainList(allDomains, e.target.value);
  });

  // Send selected
  document.getElementById("send-selected-btn").addEventListener("click", async () => {
    const checked = [...document.querySelectorAll("#domain-list input:checked")].map(
      (el) => el.value,
    );
    if (checked.length === 0) return;
    const btn = document.getElementById("send-selected-btn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const result = await sendCookies(checked);
      showResult(`Sent ${result.imported} cookies for ${checked.length} domain(s)`, false);
    } catch (e) {
      showResult(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send selected domains";
    }
  });

  // Open options
  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
```

**Step 4: Create options.html**

Create `extensions/chrome/options.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e5e5e5;
      max-width: 400px; margin: 40px auto; padding: 20px;
    }
    h1 { font-size: 20px; margin-bottom: 20px; }
    label { display: block; margin-bottom: 4px; font-size: 13px; color: #a3a3a3; }
    input {
      width: 100%; padding: 10px; margin-bottom: 16px;
      background: #171717; border: 1px solid #262626; border-radius: 6px;
      color: #e5e5e5; font-size: 14px;
    }
    button {
      padding: 10px 20px; background: #2563eb; color: white;
      border: none; border-radius: 6px; cursor: pointer; font-size: 14px;
    }
    button:hover { background: #1d4ed8; }
    .saved { color: #4ade80; margin-top: 12px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Bob Cookie Bridge Settings</h1>
  <label for="url">Bob URL</label>
  <input type="url" id="url" placeholder="https://bob.tail1e1a32.ts.net">
  <label for="key">API Key</label>
  <input type="password" id="key" placeholder="gmk_...">
  <button id="save">Save</button>
  <div class="saved" id="saved" style="display:none">Settings saved.</div>
  <script src="options.js"></script>
</body>
</html>
```

**Step 5: Create options.js**

Create `extensions/chrome/options.js`:

```javascript
/* global chrome */

document.addEventListener("DOMContentLoaded", async () => {
  const config = await chrome.storage.sync.get(["bobUrl", "bobApiKey"]);
  document.getElementById("url").value = config.bobUrl || "";
  document.getElementById("key").value = config.bobApiKey || "";

  document.getElementById("save").addEventListener("click", async () => {
    await chrome.storage.sync.set({
      bobUrl: document.getElementById("url").value.replace(/\/$/, ""),
      bobApiKey: document.getElementById("key").value,
    });
    const saved = document.getElementById("saved");
    saved.style.display = "block";
    setTimeout(() => { saved.style.display = "none"; }, 2000);
  });
});
```

**Step 6: Create placeholder icons**

> **Note to implementer:** For now, create simple 16x16, 48x48, and 128x128 PNG placeholder icons. These can be generated with any tool or replaced later with proper branding. Create the `extensions/chrome/icons/` directory and add placeholder PNGs.

**Step 7: Commit**

```bash
git add extensions/chrome/
git commit -m "feat(extension): add Chrome Manifest V3 Bob Cookie Bridge extension"
```

---

## Task 8: Firefox Extension — Port from Chrome

**Files:**
- Create: `extensions/firefox/manifest.json`
- Copy: `extensions/firefox/popup.html` (identical to Chrome)
- Copy: `extensions/firefox/popup.js` (identical to Chrome)
- Copy: `extensions/firefox/options.html` (identical to Chrome)
- Copy: `extensions/firefox/options.js` (identical to Chrome)

**Step 1: Create Firefox manifest.json**

Firefox Manifest V3 differences: uses `browser_specific_settings` for addon ID.

Create `extensions/firefox/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Bob Cookie Bridge",
  "version": "1.0.0",
  "description": "Send browser cookies to Bob for authenticated agent sessions",
  "permissions": ["cookies", "activeTab", "storage"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "cookie-bridge@bob.builder"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Step 2: Copy shared files**

Copy `popup.html`, `popup.js`, `options.html`, `options.js`, and `icons/` from `extensions/chrome/` to `extensions/firefox/`. The JS is identical — both Chrome and Firefox support the WebExtensions `chrome.*` API (Firefox also supports `browser.*` but `chrome.*` works).

**Step 3: Commit**

```bash
git add extensions/firefox/
git commit -m "feat(extension): add Firefox Bob Cookie Bridge extension"
```

---

## Task 9: CLI — `bob cookies import/list/remove`

**Files:**
- Create: `packages/cookies/package.json`
- Create: `packages/cookies/src/index.ts`
- Create: `packages/cookies/src/browser-detect.ts`
- Create: `packages/cookies/src/chromium-decrypt.ts`
- Create: `packages/cookies/src/cli.ts`
- Create: `packages/cookies/tsconfig.json`

**Step 1: Create the package**

Create `packages/cookies/package.json`:

```json
{
  "name": "@bob/cookies",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.5.0"
  }
}
```

Create `packages/cookies/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 2: Create browser-detect.ts**

> **Note to implementer:** Port the browser detection logic from gstack's `cookie-import-browser.ts` at `~/.claude/skills/gstack/browse/src/cookie-import-browser.ts`. Read that file for the exact paths. The key sections are the `BROWSERS` registry (around line 10-50) and `findBrowserProfiles()` function.

Create `packages/cookies/src/browser-detect.ts`:

```typescript
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BrowserProfile {
  browser: string;
  profilePath: string;
  profileName: string;
  cookieDbPath: string;
}

interface BrowserDef {
  name: string;
  macPath: string;
  linuxPath: string;
  keychainService: string;
}

const BROWSERS: BrowserDef[] = [
  { name: "chrome", macPath: "Google/Chrome", linuxPath: "google-chrome", keychainService: "Chrome Safe Storage" },
  { name: "chromium", macPath: "Chromium", linuxPath: "chromium", keychainService: "Chromium Safe Storage" },
  { name: "arc", macPath: "Arc/User Data", linuxPath: "arc", keychainService: "Arc Safe Storage" },
  { name: "brave", macPath: "BraveSoftware/Brave-Browser", linuxPath: "BraveSoftware/Brave-Browser", keychainService: "Brave Safe Storage" },
  { name: "edge", macPath: "Microsoft Edge", linuxPath: "microsoft-edge", keychainService: "Microsoft Edge Safe Storage" },
];

export function getKeychainService(browserName: string): string {
  const browser = BROWSERS.find((b) => b.name === browserName);
  return browser?.keychainService ?? "Chrome Safe Storage";
}

export function detectBrowsers(): BrowserProfile[] {
  const home = homedir();
  const isMac = process.platform === "darwin";
  const profiles: BrowserProfile[] = [];

  for (const browser of BROWSERS) {
    const basePath = isMac
      ? join(home, "Library", "Application Support", ...browser.macPath.split("/"))
      : join(home, ".config", ...browser.linuxPath.split("/"));

    if (!existsSync(basePath)) continue;

    // Check for profiles (Default, Profile 1, etc.)
    const entries = readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("Default") && !entry.name.startsWith("Profile")) continue;

      const cookieDb = join(basePath, entry.name, "Cookies");
      if (!existsSync(cookieDb)) continue;

      profiles.push({
        browser: browser.name,
        profilePath: join(basePath, entry.name),
        profileName: entry.name,
        cookieDbPath: cookieDb,
      });
    }
  }

  return profiles;
}

export function findProfile(browserName?: string): BrowserProfile | null {
  const all = detectBrowsers();
  if (browserName) {
    return all.find((p) => p.browser === browserName) ?? null;
  }
  // Default: first available browser
  return all[0] ?? null;
}
```

**Step 3: Create chromium-decrypt.ts**

> **Note to implementer:** Port the decryption logic from gstack's `cookie-import-browser.ts`. The key functions are `getKeychainPassword()` (line ~100), `deriveKey()` (line ~150), and `decryptCookieValue()` (line ~170). Read the gstack file carefully for the exact PBKDF2 parameters and AES-CBC setup.

Create `packages/cookies/src/chromium-decrypt.ts`:

```typescript
import { execSync } from "node:child_process";
import { copyFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import Database from "better-sqlite3";

import { type BrowserProfile, getKeychainService } from "./browser-detect";

export interface RawCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

const CHROMIUM_EPOCH_OFFSET = 11644473600n;

function getKeychainPassword(browserName: string): string {
  const service = getKeychainService(browserName);
  if (process.platform === "darwin") {
    try {
      const result = execSync(
        `security find-generic-password -s "${service}" -w`,
        { timeout: 10000, encoding: "utf8" },
      );
      return result.trim();
    } catch {
      throw new Error(
        `Failed to get keychain password for ${service}. You may need to click "Allow" in the macOS dialog.`,
      );
    }
  } else {
    // Linux v11
    try {
      const result = execSync(
        `secret-tool lookup xdg:schema chrome_libsecret_os_crypt_password_v2 application ${browserName}`,
        { timeout: 5000, encoding: "utf8" },
      );
      return result.trim();
    } catch {
      return "peanuts"; // Linux v10 fallback
    }
  }
}

function deriveKey(password: string): Buffer {
  const iterations = process.platform === "darwin" ? 1003 : 1;
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
}

function decryptValue(encryptedValue: Buffer, key: Buffer): string {
  if (encryptedValue.length === 0) return "";

  const prefix = encryptedValue.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") {
    // Unencrypted
    return encryptedValue.toString("utf8");
  }

  const data = encryptedValue.subarray(3);
  const iv = Buffer.alloc(16, 0x20); // 16 spaces
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  // Remove PKCS7 padding
  const padLen = decrypted[decrypted.length - 1]!;
  if (padLen > 0 && padLen <= 16) {
    return decrypted.subarray(0, decrypted.length - padLen).toString("utf8");
  }
  return decrypted.toString("utf8");
}

function chromiumTimestampToUnix(chromiumTs: bigint): number | null {
  if (chromiumTs === 0n) return null;
  const unixMicro = chromiumTs - CHROMIUM_EPOCH_OFFSET * 1000000n;
  return Number(unixMicro / 1000000n);
}

function mapSameSite(value: number): "Strict" | "Lax" | "None" {
  switch (value) {
    case 2: return "Strict";
    case 1: return "Lax";
    default: return "None";
  }
}

export function readCookiesForDomain(
  profile: BrowserProfile,
  domain: string,
): RawCookie[] {
  const password = getKeychainPassword(profile.browser);
  const key = deriveKey(password);

  // Copy DB to temp file (browser may have it locked)
  const tmpDb = join(tmpdir(), `bob-cookies-${Date.now()}.sqlite`);
  copyFileSync(profile.cookieDbPath, tmpDb);

  try {
    const db = new Database(tmpDb, { readonly: true });

    const rows = db
      .prepare(
        `SELECT name, encrypted_value, host_key, path, expires_utc, is_secure, is_httponly, samesite
         FROM cookies
         WHERE host_key LIKE ?`,
      )
      .all(`%${domain}%`) as Array<{
        name: string;
        encrypted_value: Buffer;
        host_key: string;
        path: string;
        expires_utc: bigint;
        is_secure: number;
        is_httponly: number;
        samesite: number;
      }>;

    db.close();

    return rows.map((row) => ({
      name: row.name,
      value: decryptValue(row.encrypted_value, key),
      domain: row.host_key,
      path: row.path,
      expires: chromiumTimestampToUnix(row.expires_utc),
      secure: row.is_secure === 1,
      httpOnly: row.is_httponly === 1,
      sameSite: mapSameSite(row.samesite),
    }));
  } finally {
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }
}
```

**Step 4: Create cli.ts**

Create `packages/cookies/src/cli.ts`:

```typescript
import { findProfile, detectBrowsers } from "./browser-detect";
import { readCookiesForDomain } from "./chromium-decrypt";

interface CliArgs {
  command: "import" | "list" | "remove";
  domains: string[];
  browser?: string;
  bobUrl: string;
  bobApiKey: string;
}

function parseArgs(args: string[]): CliArgs {
  const command = args[0] as CliArgs["command"];
  const domains: string[] = [];
  let browser: string | undefined;
  let bobUrl = process.env.BOB_URL ?? "http://localhost:3000";
  let bobApiKey = process.env.BOB_API_KEY ?? "";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--domain" && args[i + 1]) {
      domains.push(args[++i]!);
    } else if (args[i] === "--browser" && args[i + 1]) {
      browser = args[++i];
    } else if (args[i] === "--url" && args[i + 1]) {
      bobUrl = args[++i]!;
    } else if (args[i] === "--key" && args[i + 1]) {
      bobApiKey = args[++i]!;
    }
  }

  return { command, domains, browser, bobUrl, bobApiKey };
}

async function importCookies(args: CliArgs) {
  if (args.domains.length === 0) {
    console.error("Error: --domain is required for import");
    process.exit(1);
  }

  const profile = findProfile(args.browser);
  if (!profile) {
    console.error("No browser found. Available browsers:");
    const all = detectBrowsers();
    for (const p of all) console.error(`  ${p.browser} (${p.profileName})`);
    process.exit(1);
  }

  console.log(`Reading cookies from ${profile.browser} (${profile.profileName})...`);

  const allCookies = [];
  for (const domain of args.domains) {
    const cookies = readCookiesForDomain(profile, domain);
    console.log(`  ${domain}: ${cookies.length} cookies`);
    allCookies.push(...cookies);
  }

  if (allCookies.length === 0) {
    console.log("No cookies found.");
    return;
  }

  console.log(`Sending ${allCookies.length} cookies to Bob...`);

  const res = await fetch(`${args.bobUrl}/api/cookies/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.bobApiKey}`,
    },
    body: JSON.stringify({ cookies: allCookies, source: "cli" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const result = (await res.json()) as { imported: number; domains: string[] };
  console.log(`Imported ${result.imported} cookies for ${result.domains.join(", ")}`);
}

async function listCookies(args: CliArgs) {
  const res = await fetch(`${args.bobUrl}/api/trpc/cookies.list`, {
    headers: { Authorization: `Bearer ${args.bobApiKey}` },
  });

  if (!res.ok) {
    console.error("Failed to list cookies");
    process.exit(1);
  }

  const data = (await res.json()) as {
    result: { data: Array<{ domain: string; count: number; source: string; lastUpdated: string }> };
  };

  const entries = data.result.data;
  if (entries.length === 0) {
    console.log("Cookie jar is empty.");
    return;
  }

  console.log("Cookie Jar:");
  for (const e of entries) {
    console.log(`  ${e.domain} — ${e.count} cookies (${e.source}, updated ${e.lastUpdated ?? "unknown"})`);
  }
}

async function removeCookies(args: CliArgs) {
  if (args.domains.length === 0) {
    console.error("Error: --domain is required for remove");
    process.exit(1);
  }

  for (const domain of args.domains) {
    const res = await fetch(`${args.bobUrl}/api/trpc/cookies.remove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.bobApiKey}`,
      },
      body: JSON.stringify({ json: { domain } }),
    });

    if (res.ok) {
      console.log(`Removed cookies for ${domain}`);
    } else {
      console.error(`Failed to remove cookies for ${domain}`);
    }
  }
}

export async function main(argv: string[]) {
  const args = parseArgs(argv);

  if (!args.bobApiKey) {
    console.error("Error: BOB_API_KEY environment variable or --key flag required");
    process.exit(1);
  }

  switch (args.command) {
    case "import":
      return importCookies(args);
    case "list":
      return listCookies(args);
    case "remove":
      return removeCookies(args);
    default:
      console.error("Usage: bob cookies <import|list|remove> [options]");
      console.error("  import --domain <domain> [--browser <name>]");
      console.error("  list");
      console.error("  remove --domain <domain>");
      process.exit(1);
  }
}
```

**Step 5: Create index.ts**

Create `packages/cookies/src/index.ts`:

```typescript
export { detectBrowsers, findProfile, type BrowserProfile } from "./browser-detect";
export { readCookiesForDomain, type RawCookie } from "./chromium-decrypt";
export { main as cli } from "./cli";
```

**Step 6: Install dependencies and verify build**

Run:
```bash
cd /Volumes/dev/bob && pnpm install
cd /Volumes/dev/bob && pnpm -F @bob/cookies typecheck
```

**Step 7: Commit**

```bash
git add packages/cookies/
git commit -m "feat(cookies): add CLI package for Chromium cookie import with SQLite decryption"
```

---

## Task 10: Web UI — Settings > Cookie Jar

**Files:**
- Create: `apps/web/src/app/(dashboard)/settings/_components/cookie-jar.tsx`
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx` (add Cookie Jar section)

**Step 1: Create the cookie-jar component**

> **Note to implementer:** Read the existing settings components first to match the exact patterns. Specifically read `apps/web/src/app/(dashboard)/settings/_components/api-keys.tsx` and `apps/web/src/app/(dashboard)/settings/_components/collapsible-section.tsx` for the UI patterns, tRPC hook usage, and styling.

Create `apps/web/src/app/(dashboard)/settings/_components/cookie-jar.tsx`:

```typescript
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

export function CookieJar() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: cookies, isLoading } = useQuery(
    trpc.cookies.list.queryOptions(undefined),
  );

  const removeMutation = useMutation(
    trpc.cookies.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.cookies.list.queryKey() });
      },
    }),
  );

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading cookie jar...</div>;
  }

  if (!cookies || cookies.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No cookies imported yet. Use the browser extension or CLI to import cookies.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs mb-2">
        Imported cookies available to agent sessions. Values are encrypted and never displayed.
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs border-b border-border">
            <th className="text-left py-2">Domain</th>
            <th className="text-left py-2">Cookies</th>
            <th className="text-left py-2">Source</th>
            <th className="text-left py-2">Updated</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((entry) => (
            <tr key={`${entry.domain}-${entry.source}`} className="border-b border-border/50">
              <td className="py-2 font-mono text-xs">{entry.domain}</td>
              <td className="py-2">{entry.count}</td>
              <td className="py-2 text-muted-foreground">{entry.source}</td>
              <td className="py-2 text-muted-foreground text-xs">
                {entry.lastUpdated
                  ? new Date(entry.lastUpdated).toLocaleDateString()
                  : "—"}
              </td>
              <td className="py-2 text-right">
                <button
                  onClick={() => removeMutation.mutate({ domain: entry.domain })}
                  disabled={removeMutation.isPending}
                  className="text-xs text-destructive hover:text-destructive/80"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 2: Add to settings page**

> **Note to implementer:** Read `apps/web/src/app/(dashboard)/settings/page.tsx` to find the exact pattern for adding a new `CollapsibleSection`. Add the Cookie Jar section after the API Keys section.

Add to the settings page:

```typescript
import { CookieJar } from "./_components/cookie-jar";

// In the JSX, after the API Keys CollapsibleSection:
<CollapsibleSection title="Cookie Jar" defaultOpen={false}>
  <CookieJar />
</CollapsibleSection>
```

**Step 3: Verify build**

Run: `cd /Volumes/dev/bob && pnpm -F web build`

**Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/settings/_components/cookie-jar.tsx apps/web/src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(web): add Cookie Jar section to settings page"
```

---

## Task 11: Integration Test — End-to-End Cookie Flow

**Files:**
- Create: `packages/api/src/router/__tests__/cookies.test.ts`

**Step 1: Write the test**

> **Note to implementer:** Look at existing tests in `packages/api/src/router/__tests__/` to match the test setup pattern (database fixtures, auth context mocking, etc.). If no tests exist there, check `packages/api/src/__tests__/` or `apps/web/src/__tests__/`.

Create `packages/api/src/router/__tests__/cookies.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
// Import the test helpers used by existing tests in this project
// Adapt imports based on what you find in the test setup

describe("cookies router", () => {
  describe("import", () => {
    it("should encrypt and store cookies for a domain", async () => {
      // Call cookies.import with test cookies
      // Verify cookies are stored in browserCookies table
      // Verify values are encrypted (not plaintext)
    });

    it("should upsert on duplicate (userId, domain, name, path)", async () => {
      // Import same cookie twice with different value
      // Verify only one row exists with the latest value
    });
  });

  describe("list", () => {
    it("should return domain counts grouped by source", async () => {
      // Import cookies for two domains
      // Call cookies.list
      // Verify grouped results
    });
  });

  describe("remove", () => {
    it("should delete all cookies for a domain", async () => {
      // Import cookies, remove domain, verify gone
    });
  });

  describe("getForSession", () => {
    it("should return cookies only for scoped domains", async () => {
      // Import cookies for github.com and linear.app
      // Set session scope to only github.com
      // Call getForSession for github.com — should return cookies
      // Call getForSession for linear.app — should return error
    });

    it("should filter expired cookies", async () => {
      // Import cookie with past expiry
      // Call getForSession — should not include expired cookie
    });

    it("should decrypt cookie values correctly", async () => {
      // Import cookie with known value
      // Call getForSession
      // Verify decrypted value matches original
    });
  });
});
```

**Step 2: Run tests**

Run: `cd /Volumes/dev/bob && pnpm -F @bob/api test`

**Step 3: Commit**

```bash
git add packages/api/src/router/__tests__/cookies.test.ts
git commit -m "test(api): add integration tests for cookies router"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | DB schema | `packages/db/src/schema.ts` |
| 2 | Cookie vault encryption | `packages/api/src/services/crypto/cookieVault.ts` |
| 3 | tRPC router | `packages/api/src/router/cookies.ts`, `root.ts` |
| 4 | REST import endpoint | `apps/web/src/app/api/cookies/import/route.ts` |
| 5 | Gateway tool handler | `apps/gateway/src/sessions/cookieToolHandler.ts` |
| 6 | Session scoping | `apps/gateway/src/index.ts`, `protocol.ts` |
| 7 | Chrome extension | `extensions/chrome/*` |
| 8 | Firefox extension | `extensions/firefox/*` |
| 9 | CLI package | `packages/cookies/*` |
| 10 | Settings UI | `apps/web/src/app/(dashboard)/settings/` |
| 11 | Integration tests | `packages/api/src/router/__tests__/cookies.test.ts` |

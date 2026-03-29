# Cookie Bridge: Browser-to-Agent Cookie Import

**Date:** 2026-03-28
**Status:** Design complete, ready for implementation

## Problem

Bob's agent sessions need authenticated browser access (Playwright navigation, HTTP requests to authenticated APIs) but have no way to get the user's real browser cookies. Users must manually handle auth for every agent session.

## Solution

**Cookie Bridge** — two ingestion paths (browser extension + CLI), one encrypted storage layer, two consumption paths (Playwright injection + HTTP cookie jar skill).

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Ingestion | Browser extension + CLI | Extension for remote, CLI for local agents |
| Extension scope | Current site + bulk picker | One-click default, advanced toggle for multi-domain |
| Extension auth | API key from Bob settings | One-time setup, works on any network topology |
| CLI scope | Chromium-family only (v1) | Proven decryption from gstack; Firefox via extension |
| Storage | Per-user encrypted cookie jar | AES-256-GCM, same pattern as gitProviderConnections |
| Session access | Domain-scoped, explicit opt-in | Agent only gets cookies for declared domains |
| Agent consumption | `get_cookies` gateway tool | Dynamic, respects expiry, auditable |
| Playwright | `context.addCookies()` injection | Standard Playwright API |
| HTTP requests | Cookie jar skill (formats Cookie header) | Wraps `get_cookies` for fetch/curl |
| Audit | Tool calls logged to session events | Full visibility into agent cookie access |

---

## Data Model

### `browserCookies` table

Per-user encrypted cookie storage. Both extension and CLI write here via the same API.

```
browserCookies
  id          uuid PK
  userId      FK → users
  domain      string, indexed        -- e.g. "github.com"
  name        string                 -- cookie name
  value       text, encrypted        -- AES-256-GCM (same as gitProviderConnections)
  path        string, default "/"
  expires     timestamp, nullable    -- null = session cookie
  secure      boolean
  httpOnly    boolean
  sameSite    enum: Strict | Lax | None
  source      enum: extension | cli  -- how it was imported
  createdAt   timestamp
  updatedAt   timestamp

  UNIQUE (userId, domain, name, path)
```

Upsert on `(userId, domain, name, path)` — re-importing overwrites. Expired cookies lazily filtered at read time.

### `sessionCookieScopes` table

Controls which domains an agent session can access.

```
sessionCookieScopes
  id          uuid PK
  sessionId   FK → chatConversations
  domain      string                 -- allowed domain
  createdAt   timestamp
```

No scopes = no cookie access. Explicit opt-in only.

---

## Ingestion Path A: Browser Extension

**"Bob Cookie Bridge"** — Chrome + Firefox, Manifest V3.

### Popup UI

- **Default view:** Big button — "Send [github.com] cookies to Bob" (auto-detects current tab domain)
- **Advanced toggle:** Expands to domain picker with checkboxes for all cookie domains, search filter
- **Settings (options page):** Bob URL + API key (two fields)
- **Status indicator:** Green dot when Bob reachable, red when not

### Extension Permissions

- `cookies` — read cookies for any domain
- `activeTab` — detect current tab's domain
- `storage` — persist Bob URL + API key
- No `host_permissions` needed

### Flow

```
User clicks "Send" in popup
  → browser.cookies.getAll({domain})
  → POST /api/cookies/import with Authorization: Bearer <api-key>
  → Bob validates key, encrypts values, upserts to browserCookies
  → Popup shows "Sent 14 cookies for github.com"
```

---

## Ingestion Path B: CLI (SQLite Direct Read)

**Command: `bob cookies import`**

### Usage

```bash
# Import from default browser for a domain
bob cookies import --domain github.com

# Specify browser
bob cookies import --domain github.com --browser chrome

# Multiple domains
bob cookies import --domain github.com --domain linear.app

# List jar contents
bob cookies list

# Remove a domain's cookies
bob cookies remove --domain github.com
```

### Implementation

Port gstack's `cookie-import-browser.ts` decryption into `packages/cookies/`:

- **Browser detection:** Chrome, Chromium, Arc, Brave, Edge (macOS + Linux paths)
- **Decryption:** PBKDF2 + AES-128-CBC (gstack's proven pipeline)
  - macOS: keychain via `security find-generic-password`
  - Linux v10: hardcoded "peanuts", v11: `secret-tool`
- **Transport:** Calls `POST /api/cookies/import` — same endpoint as extension
- **Auth:** API key from `~/.bob/config` or `BOB_API_KEY` env var

### v1 Scope

Chromium-family only. Firefox uses a different cookie format — covered by the extension.

---

## API Endpoint

Shared by both extension and CLI:

```
POST /api/cookies/import
Authorization: Bearer <api-key>

Body: {
  cookies: [{
    name: string,
    value: string,
    domain: string,
    path: string,
    expires: number | null,
    secure: boolean,
    httpOnly: boolean,
    sameSite: "Strict" | "Lax" | "None"
  }]
}

Response: { imported: number, domain: string }
```

---

## Consumption: Agent Cookie Tool

### Gateway Tool: `get_cookies`

Exposed to agent sessions as a callable tool:

```typescript
{
  name: "get_cookies",
  description: "Get authenticated cookies for a domain from the user's cookie jar",
  parameters: {
    domain: { type: "string" }
  }
}
```

### Flow

```
Agent calls get_cookies({domain: "github.com"})
  → Gateway checks sessionCookieScopes for this session
  → Domain not in scope? Return error
  → Domain in scope? Query browserCookies, decrypt values
  → Return [{name, value, domain, path, expires, secure, httpOnly, sameSite}]
```

### Playwright Injection

```typescript
const cookies = await getCookies("github.com");
const context = await browser.newContext();
await context.addCookies(cookies);
```

### HTTP Cookie Jar Skill

Custom skill wraps `get_cookies` for fetch/curl:

```typescript
// Formats cookie array into Cookie header
Cookie: session_id=abc123; _gh_sess=xyz789

// Agent uses with fetch
fetch(url, { headers: { Cookie: cookieHeader } })

// Or curl
curl -H "Cookie: ..." https://api.github.com/...
```

The skill handles formatting. Agent asks "make authenticated request to X" and the skill assembles the header.

### Audit Trail

Every `get_cookies` call logged as a `tool_call` event on the session event stream. Full visibility into which domains an agent accessed and when.

---

## Session Scoping

Three ways to grant cookie access to a session:

### 1. Work Item Config

```typescript
// In work item metadata
cookieDomains: ["github.com", "linear.app"]
```

### 2. Session Creation UI

"Cookie access" dropdown in session start UI — pick from domains in your jar. Defaults to none.

### 3. API

```json
POST /session/start
{ "agentType": "claude", "workingDirectory": "/repo", "cookieDomains": ["github.com"] }
```

---

## Web UI: Cookie Management

New section in **Settings > Cookie Jar**:

- Table: domain, cookie count, source (extension/CLI), last updated
- Delete button per domain
- "Generate API Key" button for extension setup
- No cookie values displayed — domain, count, source, timestamp only

---

## Component Map

```
┌─────────────────────────────────────────────────────┐
│                    INGESTION                         │
│                                                     │
│  Browser Extension ──┐                              │
│  (Chrome/Firefox)    │    POST /api/cookies/import   │
│                      ├──────────────────────────────►│
│  CLI                 │    Authorization: Bearer key  │
│  (bob cookies import)┘                              │
│                                                     │
├─────────────────────────────────────────────────────┤
│                    STORAGE                           │
│                                                     │
│  browserCookies table (encrypted, per-user)         │
│  sessionCookieScopes table (per-session domains)    │
│                                                     │
├─────────────────────────────────────────────────────┤
│                    CONSUMPTION                       │
│                                                     │
│  Agent Session                                      │
│    ├── get_cookies("github.com") → Gateway API      │
│    ├── Playwright: context.addCookies(cookies)      │
│    └── HTTP Skill: Cookie header formatting         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Order

1. **Database schema** — `browserCookies` + `sessionCookieScopes` tables, encryption helpers
2. **API endpoint** — `POST /api/cookies/import` with API key auth
3. **CLI** — `bob cookies import/list/remove` (port gstack decryption)
4. **Gateway tool** — `get_cookies` with scope checking
5. **Browser extension** — Chrome manifest V3, popup UI, POST to Bob
6. **Firefox extension** — Port from Chrome (minor manifest differences)
7. **Cookie jar skill** — HTTP header formatting wrapper
8. **Web UI** — Settings > Cookie Jar management page
9. **Session scoping UI** — Domain picker in session creation

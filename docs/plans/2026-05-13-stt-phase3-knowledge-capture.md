# Phase 3: Knowledge Capture & Agent Skills

**Date:** 2026-05-13
**Status:** Ready
**Depends on:** Phase 1+2 (STT Agent Chat — committed as 6e22d30)

## Context

The STT agent chat is live in mobile-bob with voice input, Bob/OODA mode switching, and a manual promote button. The OODA backend already has a mature pipeline:

- **Promote**: mobile calls `runner.requestPromotion` -> runner picks up `promote_request` event -> `promoteNote()` writes markdown + provenance JSON to thread workspace -> git commit + push -> fires entity extraction to research-backend sidecar
- **Oracle**: pgvector semantic search + full-text with RRF merging (`oracleQuery()`)
- **Vault**: `VaultService` reads/writes/promotes to git-backed markdown (PERSONAL_VAULT_PATH / RESEARCH_VAULT_PATH)
- **Buddy tools**: 16 agent-facing tools already implemented (papers_search, dive_spawn, thread_memory_search, kb_promote_request, interest_register, etc.)
- **Wiki**: wikilink linker + writer for Obsidian-compatible `[[links]]`

The gap is that the mobile chat doesn't yet expose OODA's full capability surface to the user — promote works but thread selection, vault browsing, and oracle queries from mobile are missing.

## Goals

1. **Verify promote pipeline end-to-end** from mobile -> runner -> vault -> ~/obsidian
2. **Thread management from mobile** — select existing threads, create new ones
3. **Oracle query from mobile** — search the knowledge base from the chat screen
4. **Vault browsing** — read promoted notes from mobile
5. **Session history** — persist and restore chat sessions across app restarts

## Step 1: Verify Promote Pipeline (30 min)

The mobile promote button calls `runner.requestPromotion`. Verify:

- [ ] OODA server is running (`apps/ooda`, port 3001)
- [ ] OODA runner is running (`apps/ooda-runner`)
- [ ] `PERSONAL_VAULT_PATH=~/obsidian` is set in ooda-runner env
- [ ] Send a test message in OODA mode, get a response, tap Promote
- [ ] Confirm note appears in `~/obsidian/notes/{threadSlug}/`
- [ ] Confirm git commit was created in the vault repo

**No code changes needed.** This is pure verification.

## Step 2: Thread Selector (mobile)

Currently mobile always uses the first thread or auto-creates "Mobile Agent Chat". Users need to pick from existing threads or create new ones.

### Files to create/modify

- `features/chat/components/thread-picker.tsx` — modal/sheet listing threads with create option
- `features/chat/hooks/use-ooda-chat.ts` — accept `threadId` parameter instead of auto-selecting
- `features/chat/chat-screen.tsx` — add thread picker trigger in header

### Implementation

```typescript
// thread-picker.tsx
interface ThreadPickerProps {
  threads: OodaThread[];
  selectedId: string | null;
  onSelect: (threadId: string) => void;
  onCreate: (title: string) => void;
  visible: boolean;
  onClose: () => void;
}
```

The OODA tRPC client already has `threads.list` and `threads.create` wired. Thread picker reads from `threadsQuery.data` and calls `threads.create.mutate()` for new threads.

## Step 3: Oracle Search from Mobile

Add an oracle search button/command to the chat screen. When the user types `/search <query>` or taps a search icon, query OODA's oracle and display results inline.

### Files to create/modify

- `features/chat/hooks/use-oracle-search.ts` — wraps the oracle tRPC query
- `features/chat/components/oracle-results.tsx` — renders search results as expandable cards
- `features/chat/chat-screen.tsx` — detect `/search` command prefix, show results panel

### Oracle tRPC route

The route exists at `oracle.query` in `packages/ooda/src/api/router/oracle.ts`. Mobile needs to call:

```typescript
client.oracle.query.query({
  task: "mobile search",
  question: searchText,
  topK: 8,
})
```

Returns `OracleChunk[]` with content, source title, score, heading context.

## Step 4: Vault Browser

Lightweight read-only view of vault notes accessible from the chat screen. Users can browse promoted notes by thread.

### Files to create/modify

- `features/chat/components/vault-browser.tsx` — list notes grouped by thread
- `features/chat/hooks/use-vault-notes.ts` — wraps vault tRPC routes
- `app/vault.tsx` — dedicated route (optional, can start as in-chat panel)

### Vault tRPC routes

Already exist at `vault.list`, `vault.read` in `packages/ooda/src/api/router/vault.ts`.

## Step 5: Session History

Persist the active session ID and mode so reopening the chat screen resumes where the user left off.

### Files to modify

- `features/chat/hooks/use-ooda-chat.ts` — persist `activeSessionId` to AsyncStorage
- `features/chat/agent-mode.ts` — already persists mode (done)
- `features/chat/chat-screen.tsx` — restore session on mount

### Implementation

```typescript
const SESSION_STORAGE_KEY = "bob:agent-chat-session";

// On send success, persist session ID
onSuccess: (session) => {
  if (session?.id) {
    AsyncStorage.setItem(SESSION_STORAGE_KEY, session.id);
  }
}

// On mount, restore
useEffect(() => {
  AsyncStorage.getItem(SESSION_STORAGE_KEY).then((id) => {
    if (id) setActiveSessionId(id);
  });
}, []);
```

## Step 6: Slash Commands

Enable power-user interactions via text commands that map to buddy tool operations:

| Command | Action | Buddy Tool |
|---------|--------|------------|
| `/search <query>` | Oracle semantic search | oracle.query |
| `/papers <query>` | Academic paper search | papers_search |
| `/dive <seeds>` | Spawn autonomous research dive | dive_spawn |
| `/interests` | List standing interests | interest_list |
| `/inbox` | Show findings inbox | inbox_list |
| `/memory <query>` | Search thread memories | thread_memory_search |

### Files to create

- `features/chat/slash-commands.ts` — parser + command registry
- `features/chat/components/command-results.tsx` — renders tool results

### Implementation

```typescript
interface SlashCommand {
  name: string;
  description: string;
  parse: (args: string) => Record<string, unknown>;
  execute: (client: OodaClient, args: Record<string, unknown>) => Promise<unknown>;
  render: (result: unknown) => ChatMessage[];
}
```

Commands are intercepted before `send()` — if the text starts with `/`, it's routed to the command handler instead of the agent.

## Sequencing

| Step | Effort | Dependencies |
|------|--------|-------------|
| 1. Verify promote | 30 min | OODA server + runner running |
| 2. Thread selector | 1 hr | Step 1 verified |
| 3. Oracle search | 1 hr | None (parallel with 2) |
| 4. Vault browser | 1 hr | None (parallel with 2-3) |
| 5. Session history | 30 min | Step 2 (uses thread context) |
| 6. Slash commands | 2 hr | Steps 3-4 (uses oracle + vault hooks) |

Steps 2, 3, and 4 can be built in parallel. Step 6 builds on the hooks from 3-4.

## Future (Phase 4): Bob-OODA Bridge

Once the mobile chat has oracle search and vault browsing, the bridge enables Bob's planner to query OODA:

- Bob's planning session calls OODA oracle for context before generating plans
- Bob's execution sessions can promote findings back to OODA
- Shared thread context between Bob tasks and OODA research

This requires a server-side integration (Bob server -> OODA API), not mobile work.

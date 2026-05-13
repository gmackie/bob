# STT Agent Chat Interface Design

**Date:** 2026-05-13
**Status:** Approved
**Scope:** Voice-first agent chat in mobile-bob, serving both Bob and OODA sessions

## Summary

Add an STT-first (speech-to-text) agent chat screen to the mobile-bob Expo app. Primary input is voice using Apple's on-device Speech framework via `expo-speech-recognition`, with keyboard fallback. The screen supports two modes — Bob (tactical, existing WS gateway) and OODA (research, tRPC runner) — switchable via a segmented control. OODA mode enables knowledge capture into the Obsidian vault (`~/obsidian`) and oracle (pgvector semantic search).

## Decisions

- **App:** Unified in mobile-bob (not a separate OODA mobile app)
- **STT:** `expo-speech-recognition` — Apple Speech framework, on-device, free, private
- **Voice UX:** Hold-to-talk with slide-to-lock (becomes tap-to-toggle). Slide-left to cancel.
- **Transport:** Bob mode uses existing WS gateway; OODA mode uses tRPC `runner.sendPrompt` + SSE. Both evaluated for potential consolidation later.
- **Output:** Text-only for v1. ElevenLabs TTS planned for v2 (Bob already has the SDK scaffolding).
- **Knowledge capture:** Manual promote for v1. Agent auto-extract skills in phase 2.

## Architecture

```
┌─────────────────────────────┐
│  Mobile-Bob App (Expo 55)   │
├─────────────────────────────┤
│  Agent Chat Screen          │
│  ┌────────┐  ┌────────────┐ │
│  │  Bob   │  │   OODA     │ │
│  │  Mode  │  │   Mode     │ │
│  └───┬────┘  └─────┬──────┘ │
│      │             │        │
│  Bob WS        OODA tRPC   │
│  Gateway       Runner API   │
├─────────────────────────────┤
│  Shared Voice Input Bar     │
│  expo-speech-recognition    │
│  Apple Speech (on-device)   │
├─────────────────────────────┤
│  Future: ElevenLabs TTS     │
└─────────────────────────────┘
```

Both backends expose the same hook interface:

```typescript
interface AgentChat {
  messages: ChatMessage[];
  send: (text: string) => void;
  isStreaming: boolean;
  status: "idle" | "connecting" | "connected" | "error";
}
```

## Voice Input Component

### Gesture State Machine

```
IDLE ──press──▶ RECORDING
 ▲                │        │
 │            release    slide-up
 │                │        │
 │                ▼        ▼
 │              SEND    LOCKED
 │                        │
 │                     tap-again
 │                        │
 └────────────────────── SEND

RECORDING + slide-left ──▶ CANCEL
```

- **IDLE**: Mic button visible. Keyboard icon toggles to text input.
- **RECORDING**: Holding mic. Live interim transcript above button. Waveform animation.
- **LOCKED**: Slid up past threshold. Hands-free dictation. Tap to send, X to cancel.
- **SEND**: Finalizes transcript, calls `onSend(text)`.
- **CANCEL**: Slide left discards recording.

### Hook: `useSpeechRecognition`

Wraps `expo-speech-recognition`:

```typescript
interface SpeechRecognitionHook {
  start: () => void;
  stop: () => Promise<string>;  // returns final transcript
  cancel: () => void;
  transcript: string;           // final accumulated text
  interimTranscript: string;    // live partial result
  isListening: boolean;
  error: string | null;
}
```

## Chat Screen

### Layout

```
┌─────────────────────────────┐
│ ◀ Agent Chat    [Bob│OODA]  │  segmented control
├─────────────────────────────┤
│  Message bubbles (scroll)   │
│                             │
│  ┌ You (voice): ──────────┐ │
│  │ "What's the status     │ │
│  │  of the auth work?"    │ │
│  └────────────────────────┘ │
│                             │
│  ┌ Agent: ────────────────┐ │
│  │ The auth migration     │ │
│  │ is 80% complete...     │ │
│  │             [Promote ▲]│ │  OODA mode only
│  └────────────────────────┘ │
├─────────────────────────────┤
│ [🎤 Hold to talk]     [⌨]  │  voice bar + keyboard toggle
│  "listening..."             │  interim transcript
└─────────────────────────────┘
```

### Mode Differences

| Aspect | Bob Mode | OODA Mode |
|--------|----------|-----------|
| Backend | Bob WS gateway (`use-gateway`) | OODA tRPC (`runner.sendPrompt` + SSE) |
| Session | Bob chat session | OODA runner session (Claude/Codex) |
| Actions | Task creation, dispatch | Promote to vault, tag for KB |
| Context | Work items, projects | Research threads, domain packs |

## File Structure

```
apps/mobile-bob/src/
  app/chat.tsx                                  route entry

  features/chat/
    chat-screen.tsx                             main screen with mode switch
    hooks/
      use-agent-mode.ts                         Bob/OODA mode state + persistence
      use-bob-chat.ts                           wraps Bob WS gateway session
      use-ooda-chat.ts                          wraps OODA tRPC runner session
      use-speech-recognition.ts                 expo-speech-recognition wrapper
    components/
      voice-input-bar.tsx                       gesture state machine + UI
      message-list.tsx                          shared message rendering
      message-bubble.tsx                        individual message
      mode-toggle.tsx                           Bob/OODA segmented control
      promote-button.tsx                        OODA: promote to vault
      keyboard-input.tsx                        text fallback input
```

## Knowledge Capture Flow

### Pipeline

```
Voice Input → Transcript → Agent Session → Response
                                              │
                                    ┌─────────┴──────────┐
                                    │                     │
                              Manual Promote         Auto-Extract
                              (user taps ▲)        (phase 2)
                                    │                     │
                                    ▼                     ▼
                              Vault Note            Oracle Ingestion
                           (markdown + git)       (chunk + embed)
                                    │                     │
                                    ▼                     ▼
                              ~/obsidian/           research_vault DB
                              notes/{thread}/       (pgvector search)
                              {noteId}.md
```

### Obsidian Integration

`PERSONAL_VAULT_PATH=~/obsidian` — promoted notes land as:

```
~/obsidian/notes/{threadSlug}/{noteId}.md
```

Frontmatter (native Obsidian metadata):

```yaml
---
title: "Event sourcing tradeoffs for auth system"
kind: observation
thread: auth-migration-research
promotedAt: 2026-05-13T10:30:00Z
artifactId: abc123
tags: [event-sourcing, auth, architecture]
---
```

Wikilinks (`[[related-topic]]`) from the wiki writer are native Obsidian links.

### v1: Manual Promote

User taps "Promote" on an agent response. Calls existing `runner.requestPromotion` tRPC mutation. Note lands in vault with provenance frontmatter, committed and pushed to Obsidian git repo.

### v2: Agent Skills (Phase 2)

Runner's agent adapters get tools:

- `vault.search(query)` — semantic search the oracle
- `vault.promote(note)` — write a finding to the vault
- `vault.explore(topic)` — spawn standing interest for autonomous deep-dive
- `obsidian.link(noteA, noteB)` — create wikilinks between notes

## Dependencies

- `expo-speech-recognition` — new dependency for mobile-bob
- OODA tRPC client — needs to be configured in mobile-bob (currently only has Bob's tRPC)
- `PERSONAL_VAULT_PATH` env var set to `~/obsidian` on the OODA server

## Implementation Phases

### Phase 1: Voice Input + Chat Shell
- Add `expo-speech-recognition` to mobile-bob
- Build `useSpeechRecognition` hook
- Build `VoiceInputBar` component (gesture state machine)
- Build chat screen shell with mode toggle
- Wire Bob mode to existing WS gateway

### Phase 2: OODA Backend Integration
- Add OODA tRPC client to mobile-bob
- Build `useOodaChat` hook (runner.sendPrompt + SSE streaming)
- Wire OODA mode to runner backend
- Add promote-to-vault action on messages

### Phase 3: Knowledge Capture Polish
- Set `PERSONAL_VAULT_PATH=~/obsidian` and verify notes land correctly
- Frontmatter formatting for Obsidian compatibility
- Thread selection/creation from mobile
- Session history persistence

### Phase 4: Agent Skills (Future)
- Agent tools for vault/oracle interaction
- Standing interests scheduler for autonomous exploration
- Auto-extract pipeline
- ElevenLabs TTS for agent responses

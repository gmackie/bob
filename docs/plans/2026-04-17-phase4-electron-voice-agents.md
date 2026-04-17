# Phase 4: Electron Shell, Voice Capture, Autonomous Agents

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a desktop Electron app with system-wide hotkey capture, voice input support, and autonomous agent exploration that writes wiki articles independently.

**Architecture:** Electron main process manages the window, hotkey, and tray. Web UI renders inside Electron via BrowserWindow loading the Next.js dev server (or built output). Voice capture receives text from Wispr Flow (clipboard/input monitoring). Autonomous agents run as background Effect services on the server, dispatching Claude with a research prompt and writing wiki articles, checking in via the mobile notification channel.

**Tech Stack:** Electron 40+, electron-builder, Vite (for main process), existing Effect server + contracts

---

## Phase 4A: Electron Desktop App

### Task 28: Scaffold Electron app shell

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/preload.ts`
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/vite.main.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "@gmacko/desktop",
  "private": true,
  "version": "0.1.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "vite build --watch --config vite.main.config.ts & sleep 2 && electron .",
    "build": "vite build --config vite.main.config.ts && electron-builder",
    "start": "electron ."
  },
  "dependencies": {
    "electron-updater": "^6.0.0"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "electron": "^40.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.9.0",
    "vite": "^8.0.0"
  }
}
```

**Step 2: Create main process**

```ts
// apps/desktop/src/main.ts
import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } from "electron";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const WEB_URL = isDev ? "http://localhost:3000" : `file://${path.join(__dirname, "../web/index.html")}`;

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111113",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(WEB_URL);
  mainWindow.on("closed", () => { mainWindow = null; });
}

function createCaptureWindow() {
  if (captureWindow) {
    captureWindow.focus();
    return;
  }

  captureWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  captureWindow.loadURL(`${WEB_URL}/capture`);
  captureWindow.on("closed", () => { captureWindow = null; });
  captureWindow.on("blur", () => {
    captureWindow?.close();
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Gmacko");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Gmacko", click: () => createMainWindow() },
    { label: "Quick Capture", accelerator: "CmdOrCtrl+Shift+Space", click: () => createCaptureWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  createMainWindow();
  createTray();

  // System-wide hotkey for quick capture
  globalShortcut.register("CmdOrCtrl+Shift+Space", () => {
    createCaptureWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray on macOS
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
```

**Step 3: Create preload**

```ts
// apps/desktop/src/preload.ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gmacko", {
  platform: process.platform,
  isDesktop: true,
  capture: {
    close: () => ipcRenderer.send("capture:close"),
    submit: (text: string) => ipcRenderer.send("capture:submit", text),
  },
});
```

**Step 4: Create vite config for main process**

```ts
// apps/desktop/vite.main.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        main: "src/main.ts",
        preload: "src/preload.ts",
      },
      formats: ["cjs"],
    },
    outDir: "dist",
    rollupOptions: {
      external: ["electron"],
    },
  },
});
```

**Step 5: Create electron-builder config**

```yaml
# apps/desktop/electron-builder.yml
appId: io.gmac.gmacko
productName: Gmacko
mac:
  category: public.app-category.productivity
  target:
    - dmg
    - zip
  darkModeSupport: true
directories:
  output: release
```

**Step 6: Install and verify**

```bash
pnpm install
cd apps/desktop && pnpm build  # Just build main process, don't need electron-builder yet
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add Electron desktop app shell with system-wide capture hotkey"
```

---

### Task 29: Create capture page in web app

**Files:**
- Create: `apps/web/src/app/capture/page.tsx`

**Step 1: Create capture page**

A minimal, floating-panel-style page for quick idea capture:
- Dark, translucent background
- Auto-focusing text input (supports multi-line)
- Submit sends to agent.chat (quick response mode)
- Response shown inline below input
- Escape or blur closes the window (Electron handles this)
- Can also be accessed at /capture in the browser

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useCreateThread, useAgentChat } from "@/rpc/hooks";

export default function CapturePage() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const createThread = useCreateThread();
  const agentChat = useAgentChat();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;
    setIsLoading(true);
    try {
      // Create a quick capture thread
      const thread = await createThread.mutateAsync({ title: input.trim().slice(0, 60) });
      // Send to agent
      const msg = await agentChat.mutateAsync({
        threadId: thread.id,
        branchId: thread.activeBranchId!,
        content: input.trim(),
      });
      setResponse(msg.content);
    } catch (err) {
      setResponse("Error: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      // In Electron, this will blur → close the window
      window.blur();
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg)]/95 p-8">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 shadow-2xl">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind?"
          rows={3}
          className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-muted)]">⌘+Enter to send · Esc to close</span>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            {isLoading ? "Thinking..." : "Capture"}
          </button>
        </div>
        {response && (
          <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4 text-sm text-[var(--color-text)]">
            {response}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add quick capture page for floating panel"
```

---

## Phase 4B: Voice Input

### Task 30: Add voice input support to capture

**Files:**
- Create: `apps/web/src/components/voice-input.tsx`
- Modify: `apps/web/src/app/capture/page.tsx`

**Step 1: Create VoiceInput component**

For now, use the Web Speech API (SpeechRecognition) as a simple voice input that works in Chromium/Electron. This provides basic voice-to-text that Wispr Flow can also pipe into.

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  className?: string;
}

export function VoiceInput({ onTranscript, className }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        onTranscript(last[0].transcript);
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return (
    <button
      onClick={isListening ? stopListening : startListening}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isListening
          ? "bg-[var(--color-error)] text-white animate-pulse"
          : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      } ${className}`}
    >
      {isListening ? "⏹ Stop" : "🎤 Voice"}
    </button>
  );
}
```

**Step 2: Add VoiceInput to capture page**

Add the VoiceInput button next to the submit button. When voice transcript arrives, append it to the input textarea.

**Step 3: Add global SpeechRecognition type declaration**

Create `apps/web/src/types/speech.d.ts` with SpeechRecognition interface declarations for TypeScript.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add voice input via Web Speech API for capture"
```

---

## Phase 4C: Autonomous Agent Exploration

### Task 31: Add exploration dispatch to server

**Files:**
- Create: `apps/server/src/services/explorer.ts`
- Modify: `packages/contracts/src/rpc.ts` — add exploration RPCs
- Modify: `packages/contracts/src/schemas/exploration.ts`
- Modify: `apps/server/src/rpc-handler.ts` — add exploration handlers

**Step 1: Define exploration schemas**

```ts
// packages/contracts/src/schemas/exploration.ts
import { Schema } from "effect";

export const ExplorationStatus = Schema.Literals(["running", "paused", "completed", "awaiting_input"]);

export const ExplorationCheckIn = Schema.Struct({
  id: Schema.String,
  explorationId: Schema.String,
  summary: Schema.String,
  suggestedDirections: Schema.Array(Schema.String),
  articlesWritten: Schema.Array(Schema.String),
  depth: Schema.Number,
  status: ExplorationStatus,
  createdAt: Schema.Date,
});
export type ExplorationCheckIn = typeof ExplorationCheckIn.Type;

export const StartExplorationInput = Schema.Struct({
  threadId: Schema.String,
  branchId: Schema.String,
  topic: Schema.String,
  maxDepth: Schema.optionalWith(Schema.Number, { default: () => 5 }),
});

export const RespondToCheckInInput = Schema.Struct({
  explorationId: Schema.String,
  checkInId: Schema.String,
  direction: Schema.Literals(["continue", "go_deeper", "redirect", "stop"]),
  redirectTopic: Schema.optional(Schema.String),
});

export const ExplorationSummary = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  topic: Schema.String,
  status: ExplorationStatus,
  depth: Schema.Number,
  articlesWritten: Schema.Number,
  lastCheckIn: Schema.NullOr(ExplorationCheckIn),
});
```

**Step 2: Add RPCs**

Add to contracts/src/rpc.ts:
- `exploration.start` — start autonomous exploration on a topic
- `exploration.respond` — respond to a check-in (continue, redirect, stop)
- `exploration.status` — get current status of an exploration
- `exploration.list` — list all explorations

**Step 3: Create ExplorerService**

The explorer service:
1. Receives a topic and max depth
2. Runs in a loop:
   a. Sends topic to Claude with a research prompt
   b. Claude responds with findings + suggested subtopics
   c. Writes a wiki article for the findings
   d. Creates a check-in with summary + suggested directions
   e. Waits for user response (via mobile notification)
   f. Based on response: go deeper on a subtopic, redirect, or stop
3. At each depth level, the agent:
   - Asks Claude to identify key subtopics from its findings
   - Creates stub wiki articles for subtopics it didn't explore
   - Cross-links new articles with existing ones
4. Stops at maxDepth or when user says stop

```ts
// apps/server/src/services/explorer.ts
import { Effect, Ref, Queue } from "effect";
// ... service implementation
```

The service stores exploration state in memory (for now — can persist to DB later).

**Step 4: Wire into RPC handler**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add autonomous exploration service with check-in loop"
```

---

### Task 32: Add exploration UI to web + mobile

**Files:**
- Create: `apps/web/src/app/explore/page.tsx`
- Create: `apps/mobile/src/app/explore.tsx`
- Modify: `apps/web/src/rpc/hooks.ts` — add exploration hooks
- Modify: `apps/mobile/src/utils/api.tsx` — add exploration methods

**Step 1: Web exploration page**

Shows:
- Active explorations with status and depth
- Check-in cards with summary, suggested directions, and action buttons
- List of wiki articles written by exploration
- "Start Exploration" button that takes a topic

**Step 2: Mobile exploration screen**

Simpler view focused on:
- Notification-style check-in cards
- Quick action buttons (Continue, Go Deeper, Redirect, Stop)
- This is the PI's command channel

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add exploration UI for web and mobile with check-in actions"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 28 | Electron app shell with system-wide hotkey + tray |
| 29 | Quick capture page (/capture) for floating panel |
| 30 | Voice input via Web Speech API |
| 31 | Autonomous exploration service with check-in loop |
| 32 | Exploration UI in web + mobile |

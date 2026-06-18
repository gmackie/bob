# Agent Operations Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify Bob's execution daemon to handle all session types (execution, planning, BizPulse) via the persona system, integrate Pulse CLI for BizPulse agents, and add token/cost tracking with BizPulse session reporting.

**Architecture:** The execution daemon becomes the single entry point for all agent sessions. Persona config (model, tools, system prompt) flows from the API → gateway → daemon via `ServerSessionAvailable`. Planning sessions migrate from hardcoded smol-agent profiles to a Planner persona. BizPulse agents use Pulse CLI via Bash with a shared `PULSE_API_KEY`. Session close fires a cost report to BizPulse via a plain REST endpoint.

**Tech Stack:** TypeScript, Drizzle ORM, tRPC, WebSocket, Pulse CLI, YAML (js-yaml)

**Design doc:** `docs/plans/2026-05-14-agent-ops-integration.md`

**Key findings from grilling session (incorporated):**
1. `startPlanningSession()` is dead code with zero callers — delete it and all smol-agent profiles
2. `planSessionStart()` in `packages/bob/src/api/src/handlers/planSession.ts` is the active planning entry point
3. ws-gateway silently drops fields not in `NudgeBody` / `NudgeInput` — must extend both
4. `--print` mode produces no JSON usage data — switch to `--output-format stream-json`
5. `tenantId` is NOT NULL in `agent_personas` but never set in persona handlers — use `BOB_TENANT_ID` env var
6. BizPulse expects tRPC batch format — add plain REST endpoint `POST /api/agent/report-session` instead
7. BizPulse REST endpoint should auto-create agent records on first report (no manual setup)
8. Planning tools (`create_draft_task` etc.) were never wired — Planner persona focuses on analysis, not tool calls
9. `reactFrontend` conditional in prompt building is unnecessary — drop it
10. `tokenUsageSessions` table requires FKs (`instanceId`, `worktreeId`, `repositoryId`) the daemon doesn't have — skip writing to it

---

### Task 1: Create model-pricing.ts + add package export

**Files:**
- Create: `packages/core/src/agent/model-pricing.ts`
- Modify: `packages/core/package.json` (add export)

**Step 1: Write the module**

```typescript
// packages/core/src/agent/model-pricing.ts

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export const MODEL_PRICING: Record<
  string,
  { inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheCreationPer1M: number }
> = {
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3, cacheCreationPer1M: 3.75 },
  "claude-opus-4-6": { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5, cacheCreationPer1M: 18.75 },
  "claude-opus-4-7": { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5, cacheCreationPer1M: 18.75 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0, cacheReadPer1M: 0.08, cacheCreationPer1M: 1.0 },
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function computeCostMicrocents(model: string, tokens: TokenCounts): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL]!;
  const inputCost = (tokens.input / 1_000_000) * pricing.inputPer1M;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPer1M;
  const cacheCost =
    (tokens.cacheRead / 1_000_000) * pricing.cacheReadPer1M +
    (tokens.cacheCreation / 1_000_000) * pricing.cacheCreationPer1M;
  return Math.round((inputCost + outputCost + cacheCost) * 100_000_000);
}

export function computeCostUsd(model: string, tokens: TokenCounts): number {
  return computeCostMicrocents(model, tokens) / 100_000_000;
}
```

**Step 2: Add package export**

In `packages/core/package.json`, add to the `"exports"` object:

```json
"./agent/model-pricing": "./src/agent/model-pricing.ts"
```

Add it after the `"./agent/errors"` entry.

**Step 3: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p packages/core/tsconfig.json`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/core/src/agent/model-pricing.ts packages/core/package.json
git commit -m "feat(core): add model-pricing.ts with token cost calculation"
```

---

### Task 2: Fix tenantId in persona handlers

**Files:**
- Modify: `packages/bob/src/api/src/handlers/context.ts` (add tenantId)
- Modify: `packages/bob/src/api/src/handlers/persona.ts` (use tenantId in all queries)

The `agent_personas` table has `tenantId NOT NULL` with a unique index on `(tenantId, slug)`. All persona handlers currently omit `tenantId`, which means inserts will fail on the real DB.

**Step 1: Add tenantId to HandlerContext**

In `packages/bob/src/api/src/handlers/context.ts`, add `tenantId` to `HandlerContext`:

```typescript
export interface HandlerContext {
  readonly db: any;
  readonly userId: string;
  readonly tenantId: string;
}
```

**Step 2: Thread BOB_TENANT_ID through to context construction**

Find where `HandlerContext` is constructed. Check `packages/bob/src/api/src/rpc-handlers/index.ts` — it likely builds the context from the tRPC context. Add:

```typescript
const tenantId = process.env.BOB_TENANT_ID ?? "";
```

And include `tenantId` in the context object passed to handlers.

**Step 3: Add tenantId to persona create**

In `packages/bob/src/api/src/handlers/persona.ts`, update `personaCreate`:

```typescript
const [persona] = await ctx.db
  .insert(agentPersonas)
  .values({
    tenantId: ctx.tenantId,  // ADD THIS
    name: input.name,
    // ... rest unchanged
  })
  .returning();
```

**Step 4: Add tenantId scoping to list, get, update, delete**

Add `eq(agentPersonas.tenantId, ctx.tenantId)` to the WHERE clause of all queries in `personaList`, `personaGet`, `personaUpdate`, `personaDelete`.

For `personaList`:
```typescript
conditions.push(eq(agentPersonas.tenantId, ctx.tenantId));
```

For `personaGet`:
```typescript
.where(and(eq(agentPersonas.id, input.id), eq(agentPersonas.tenantId, ctx.tenantId)))
```

Same pattern for `personaUpdate` and `personaDelete`.

**Step 5: Add personaGetBySlug helper**

Add after `personaGet` in `persona.ts`:

```typescript
export async function personaGetBySlug(
  ctx: HandlerContext,
  input: { slug: string },
) {
  const [persona] = await ctx.db
    .select()
    .from(agentPersonas)
    .where(
      and(
        eq(agentPersonas.tenantId, ctx.tenantId),
        eq(agentPersonas.slug, input.slug),
        eq(agentPersonas.active, true),
      ),
    )
    .limit(1);
  return persona ?? null;
}
```

**Step 6: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p packages/bob/tsconfig.json`
Expected: No errors. There may be downstream callers that construct HandlerContext without `tenantId` — fix those too.

**Step 7: Commit**

```bash
git add packages/bob/src/api/src/handlers/context.ts packages/bob/src/api/src/handlers/persona.ts
git commit -m "fix(persona): add tenantId scoping to all persona CRUD handlers"
```

---

### Task 3: Extend ws-gateway with persona fields

**Files:**
- Modify: `apps/bob-ws-gateway/src/nudge.ts` (NudgeBody interface)
- Modify: `apps/bob-ws-gateway/src/relay.ts` (NudgeInput interface + nudgeSession + DB polling)

The gateway is a bottleneck: it defines `NudgeBody` and `NudgeInput` interfaces that control which fields flow from the API nudge through to the daemon. Fields not in these interfaces are silently dropped.

**Step 1: Extend NudgeBody in nudge.ts**

In `apps/bob-ws-gateway/src/nudge.ts`, add `personaId` and `personaConfig` to the `NudgeBody` interface:

```typescript
interface NudgeBody {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  description?: string;
  identifier?: string;
  branch?: string;
  sessionType?: "execution" | "planning";
  planningContext?: Record<string, unknown>;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
}
```

**Step 2: Extend NudgeInput in relay.ts**

In `apps/bob-ws-gateway/src/relay.ts`, update the `NudgeInput` interface (line ~43-59):

```typescript
interface NudgeInput {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  planningContext?: {
    workspaceId: string;
    projectId: string;
    projectName: string;
    launchContext?: unknown;
  };
  description?: string;
  identifier?: string;
  branch?: string;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
}
```

**Step 3: Forward persona fields in nudgeSession()**

In `relay.ts` `nudgeSession()` (line 131-147), add `personaId` and `personaConfig` to the sent message:

```typescript
nudgeSession(input: NudgeInput): void {
  const daemon = this.daemonByWorkspace.get(input.workspaceId);
  if (!daemon) return;

  this.send(daemon, {
    type: "session_available",
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    agentType: input.agentType,
    title: input.title,
    sessionType: input.sessionType ?? "execution",
    planningContext: input.planningContext as any,
    description: input.description,
    identifier: input.identifier,
    branch: input.branch,
    personaId: input.personaId,
    personaConfig: input.personaConfig,
  });
}
```

**Step 4: Forward persona fields in DB-polling recovery path**

In the `handleHello()` method, the daemon-connect recovery path (line 356-407) constructs `session_available` messages from DB rows. Add persona metadata:

After line 382 (where `description`, `identifier`, `branch` are set), add:

```typescript
const personaMetadata = (session as any).personaMetadata as Record<string, unknown> | null;
```

Then in the `this.send(conn, ...)` block, add:

```typescript
personaId: (session as any).personaId ?? undefined,
personaConfig: personaMetadata ? {
  model: typeof personaMetadata.model === "string" ? personaMetadata.model : undefined,
  systemPrompt: typeof personaMetadata.systemPrompt === "string" ? personaMetadata.systemPrompt : undefined,
  allowedTools: Array.isArray(personaMetadata.allowedTools) ? personaMetadata.allowedTools : undefined,
  autonomyLevel: typeof personaMetadata.autonomyLevel === "string" ? personaMetadata.autonomyLevel : undefined,
  metadata: typeof personaMetadata.metadata === "object" ? personaMetadata.metadata as Record<string, unknown> : undefined,
} : undefined,
```

**Step 5: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p apps/bob-ws-gateway/tsconfig.json`
Expected: No errors

**Step 6: Commit**

```bash
git add apps/bob-ws-gateway/src/nudge.ts apps/bob-ws-gateway/src/relay.ts
git commit -m "feat(gateway): forward persona fields in nudge + DB recovery paths"
```

---

### Task 4: Daemon — extend interfaces, add Pulse env, remove planning skip, switch to stream-json

**Files:**
- Modify: `apps/bob-execution/src/daemon/index.ts`

This is the core daemon unification task. Four changes:

**Step 1: Extend ServerSessionAvailable interface**

Replace the interface at line 38-48:

```typescript
interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  description?: string;
  identifier?: string;
  branch?: string;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
  planningContext?: {
    workspaceId?: string;
    projectId?: string;
    projectName?: string;
    launchContext?: {
      intent: "shape" | "breakdown";
      notes: string;
      workItem?: { id: string; identifier: string; title: string; kind: string };
      selectedRepoSources: Array<{ id: string; label: string; path: string; detail: string }>;
      attachedFiles: Array<{ name: string; sizeLabel: string; content?: string }>;
    };
  };
}
```

**Step 2: Remove the planning skip guard**

Delete lines 167-170 in `handleSessionAvailable()`:

```typescript
// DELETE THIS BLOCK:
if (session.sessionType === "planning") {
  console.log(`[executor] Skipping planning session ${session.sessionId}`);
  return;
}
```

**Step 3: Add PULSE_API_KEY and PULSE_API_URL to spawn env**

In `runAgent()` at line 306-313, update the env block:

```typescript
env: {
  ...process.env,
  CI: "true",
  TERM: "dumb",
  PULSE_API_KEY: process.env.PULSE_API_KEY ?? "",
  PULSE_API_URL: process.env.PULSE_API_URL ?? "https://bizpulse.cc",
},
```

**Step 4: Switch getAgentCommand to use --output-format stream-json**

In `getAgentCommand()` (line 428-451), replace `--print` with `--output-format stream-json` for the claude cases. Keep `--dangerously-skip-permissions`:

```typescript
function getAgentCommand(agentType: string, prompt: string, persona?: PersonaConfig): { command: string; args: string[] } {
  switch (agentType) {
    case "claude": {
      const args = ["--output-format", "stream-json", "--dangerously-skip-permissions"];
      if (persona?.model) args.push("--model", persona.model);
      if (persona?.allowedTools?.length) args.push("--allowedTools", persona.allowedTools.join(","));
      if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
      args.push(prompt);
      return { command: "claude", args };
    }
    case "codex":
      return { command: "codex", args: ["--quiet", "--full-auto", prompt] };
    case "opencode":
      return { command: "opencode", args: ["run", prompt] };
    default: {
      const defaultArgs = ["--output-format", "stream-json", "--dangerously-skip-permissions"];
      if (persona?.model) defaultArgs.push("--model", persona.model);
      if (persona?.allowedTools?.length) defaultArgs.push("--allowedTools", persona.allowedTools.join(","));
      if (persona?.systemPrompt) defaultArgs.push("--append-system-prompt", persona.systemPrompt);
      defaultArgs.push(prompt);
      return { command: "claude", args: defaultArgs };
    }
  }
}
```

**Step 5: Update getPersonaConfig to prefer personaConfig from message**

Replace `getPersonaConfig()` (line 408-426):

```typescript
function getPersonaConfig(session: ServerSessionAvailable): PersonaConfig {
  if (session.personaConfig) {
    let systemPrompt = session.personaConfig.systemPrompt;
    const autonomyLevel = session.personaConfig.autonomyLevel;
    if (autonomyLevel && systemPrompt) {
      systemPrompt = `${systemPrompt}\n\nAutonomy level: ${autonomyLevel}. Operate within this level.`;
    } else if (autonomyLevel) {
      systemPrompt = `Autonomy level: ${autonomyLevel}. Operate within this level.`;
    }
    return {
      model: session.personaConfig.model,
      allowedTools: session.personaConfig.allowedTools,
      systemPrompt,
      autonomyLevel,
    };
  }

  const meta = (session as any).personaMetadata as Record<string, unknown> | null;
  if (!meta) return {};

  let systemPrompt = typeof meta.systemPrompt === "string" ? meta.systemPrompt : undefined;
  const autonomyLevel = typeof meta.autonomyLevel === "string" ? meta.autonomyLevel : undefined;
  if (autonomyLevel && systemPrompt) {
    systemPrompt = `${systemPrompt}\n\nAutonomy level: ${autonomyLevel}. Operate within this level.`;
  } else if (autonomyLevel) {
    systemPrompt = `Autonomy level: ${autonomyLevel}. Operate within this level.`;
  }

  return {
    model: typeof meta.model === "string" ? meta.model : undefined,
    allowedTools: Array.isArray(meta.allowedTools) ? meta.allowedTools as string[] : undefined,
    systemPrompt,
    autonomyLevel,
  };
}
```

**Step 6: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p apps/bob-execution/tsconfig.json`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/bob-execution/src/daemon/index.ts
git commit -m "feat(daemon): unify session handling — persona support, Pulse env, stream-json output"
```

---

### Task 5: Daemon — context-aware buildPrompt

**Files:**
- Modify: `apps/bob-execution/src/daemon/index.ts` (buildPrompt function, line 243-263)

**Step 1: Rewrite buildPrompt**

Replace the entire `buildPrompt()` function:

```typescript
function buildPrompt(session: ServerSessionAvailable): string {
  const parts: string[] = [];

  if (session.identifier && session.title) {
    parts.push(`Task: ${session.identifier} - ${session.title}`);
  } else if (session.title) {
    parts.push(`Task: ${session.title}`);
  }

  if (session.description) {
    parts.push(`\nDescription:\n${session.description}`);
  }

  if (session.branch) {
    parts.push(`\nWork on branch: ${session.branch}`);
  }

  // Planning context
  if (session.planningContext) {
    const pc = session.planningContext;
    if (pc.projectName) {
      parts.push(`\nProject: ${pc.projectName}`);
    }
    if (pc.launchContext) {
      const lc = pc.launchContext;
      parts.push(`\nPlanning intent: ${lc.intent}`);
      if (lc.notes) parts.push(`\nBrief: ${lc.notes}`);
      if (lc.workItem) {
        parts.push(`\nWork item: ${lc.workItem.identifier} - ${lc.workItem.title} (${lc.workItem.kind})`);
      }
      if (lc.selectedRepoSources?.length) {
        parts.push(`\nRepo context:`);
        for (const src of lc.selectedRepoSources) {
          parts.push(`  - ${src.label} (${src.path}): ${src.detail}`);
        }
      }
      if (lc.attachedFiles?.length) {
        parts.push(`\nAttached files:`);
        for (const f of lc.attachedFiles) {
          parts.push(`  - ${f.name} [${f.sizeLabel}]`);
          if (f.content?.trim()) {
            parts.push(`    ${f.content.trim().split("\n").join("\n    ")}`);
          }
        }
      }
    }
  }

  // BizPulse startup context
  const bizpulse = session.personaConfig?.metadata?.bizpulse as
    | { startupSlug?: string }
    | undefined;
  if (bizpulse?.startupSlug) {
    parts.push(`\nYou are operating on startup: ${bizpulse.startupSlug}`);
  }

  // Closing instruction
  if (session.sessionType === "planning") {
    parts.push("\n\nAnalyze the codebase and create a structured plan with draft tasks.");
  } else {
    parts.push("\n\nImplement this task. Create a commit when done.");
  }

  return parts.join("\n");
}
```

**Step 2: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p apps/bob-execution/tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/bob-execution/src/daemon/index.ts
git commit -m "feat(daemon): context-aware prompt building for planning + BizPulse"
```

---

### Task 6: Daemon — rewrite parseTokenUsage for stream-json + add reportToBizPulse

**Files:**
- Modify: `apps/bob-execution/src/daemon/index.ts`

With `--output-format stream-json`, Claude CLI outputs NDJSON lines. The final line is a `{"type":"result",...}` object containing `usage` and `total_cost_usd`. Example:

```json
{"type":"result","subtype":"success","duration_ms":2627,"result":"hello","total_cost_usd":0.2968125,"usage":{"input_tokens":5,"cache_creation_input_tokens":47462,"cache_read_input_tokens":0,"output_tokens":6}}
```

**Step 1: Add model-pricing import**

Add at the top of the file:

```typescript
import { computeCostUsd, type TokenCounts } from "@gmacko/core/agent/model-pricing";
```

Check that `apps/bob-execution/package.json` has `@gmacko/core` as a dependency. If not, the daemon likely uses `@bob/` scope — search for how it resolves. If the import path doesn't work, fall back to a relative import or inline the pricing logic.

**Step 2: Rewrite parseTokenUsage**

Replace the `parseTokenUsage` function (line 372-399) and add the `ParsedTokenUsage` interface:

```typescript
interface ParsedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  model: string;
}

function parseTokenUsage(output: string, personaModel?: string): ParsedTokenUsage {
  const defaults: ParsedTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    model: personaModel ?? "claude-sonnet-4-6",
  };

  try {
    const lines = output.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i]!.trim();
      if (!trimmed.startsWith("{")) continue;
      const json = JSON.parse(trimmed);
      if (json.type === "result" && json.usage) {
        const tokens: TokenCounts = {
          input: json.usage.input_tokens ?? 0,
          output: json.usage.output_tokens ?? 0,
          cacheRead: json.usage.cache_read_input_tokens ?? 0,
          cacheCreation: json.usage.cache_creation_input_tokens ?? 0,
        };
        const model = personaModel ?? "claude-sonnet-4-6";
        return {
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cacheReadTokens: tokens.cacheRead,
          cacheCreationTokens: tokens.cacheCreation,
          costUsd: json.total_cost_usd ?? computeCostUsd(model, tokens),
          model,
        };
      }
    }
  } catch {
    // best-effort parsing
  }
  return defaults;
}
```

**Step 3: Add reportToBizPulse function**

Add after `parseTokenUsage`:

```typescript
async function reportToBizPulse(
  session: ServerSessionAvailable,
  status: "completed" | "failed",
  tokenUsage: ParsedTokenUsage,
  durationMs: number,
  finalOutput: string,
): Promise<void> {
  const bizpulse = session.personaConfig?.metadata?.bizpulse as
    | { apiUrl?: string; agentSlug?: string; startupSlug?: string }
    | undefined;

  if (!bizpulse?.apiUrl || !bizpulse?.agentSlug) return;

  const costMicrocents = Math.round(tokenUsage.costUsd * 100_000_000);

  try {
    await fetch(`${bizpulse.apiUrl}/api/agent/report-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.PULSE_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        agentSlug: bizpulse.agentSlug,
        externalSessionId: session.sessionId,
        startupSlug: bizpulse.startupSlug ?? null,
        title: session.title ?? null,
        status,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        cacheReadTokens: tokenUsage.cacheReadTokens,
        cacheCreationTokens: tokenUsage.cacheCreationTokens,
        costMicrocents,
        durationMs,
        summary: finalOutput.slice(-2000),
      }),
    });
    console.log(`[executor] BizPulse report sent for session ${session.sessionId}`);
  } catch (err) {
    console.warn(`[executor] BizPulse report failed (fire-and-forget):`, err);
  }
}
```

**Step 4: Update runAgent to accept full session + wire reporting**

Change `runAgent` signature to accept the full session object:

```typescript
function runAgent(session: ServerSessionAvailable, workDir: string, prompt: string, persona?: PersonaConfig): Promise<AgentExecutionResult> {
  return new Promise((resolve, reject) => {
    const sessionId = session.sessionId;
    const agentType = session.agentType || "claude";
    const { command, args } = getAgentCommand(agentType, prompt, persona);
    console.log(`[executor] Spawning: ${command} ${args.join(" ").slice(0, 80)}...`);

    const startTime = Date.now();

    const child = spawn(command, args, {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: "true",
        TERM: "dumb",
        PULSE_API_KEY: process.env.PULSE_API_KEY ?? "",
        PULSE_API_URL: process.env.PULSE_API_URL ?? "https://bizpulse.cc",
      },
    });

    activeSessions.set(sessionId, child);

    let output = "";

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      sendEvent(sessionId, "output_chunk", "agent", {
        data: chunk,
        stream: "stdout",
      });
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      sendEvent(sessionId, "output_chunk", "agent", {
        data: chunk,
        stream: "stderr",
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const tokenUsage = parseTokenUsage(output, persona?.model);
      const result: AgentExecutionResult = {
        exitCode: code ?? 1,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        costUsd: tokenUsage.costUsd,
      };

      void reportToBizPulse(
        session,
        code === 0 ? "completed" : "failed",
        tokenUsage,
        durationMs,
        output,
      );

      if (code === 0) {
        sendEvent(sessionId, "message_final", "agent", {
          content: output.slice(-2000),
          role: "assistant",
        });
        resolve(result);
      } else {
        reject(new Error(`Agent exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn agent: ${err.message}`));
    });

    const timeout = setTimeout(() => {
      console.warn(`[executor] Session ${sessionId} timed out, killing agent`);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, 30 * 60 * 1000);

    child.on("close", () => clearTimeout(timeout));
  });
}
```

**Step 5: Update the call site in handleSessionAvailable**

Change the `runAgent` call in `handleSessionAvailable` (inside the `traceAgentExecution` callback, line 219):

```typescript
const result = await runAgent(session, workDir, prompt, persona);
```

(Previously was `runAgent(session.sessionId, agentType, workDir, prompt, persona)`)

**Step 6: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p apps/bob-execution/tsconfig.json`
Expected: No errors. If `@gmacko/core/agent/model-pricing` import fails, check `apps/bob-execution/package.json` dependencies and adjust the import path.

**Step 7: Commit**

```bash
git add apps/bob-execution/src/daemon/index.ts
git commit -m "feat(daemon): stream-json token parsing + BizPulse session reporting"
```

---

### Task 7: Migrate planSessionStart to resolve Planner persona

**Files:**
- Modify: `packages/bob/src/api/src/handlers/planSession.ts` (planSessionStart, line 143-223)

**Step 1: Add agentPersonas import**

Add to the imports at the top of the file:

```typescript
import { agentPersonas } from "@bob/db/schema";
```

**Step 2: Update planSessionStart to resolve Planner persona**

Rewrite the function body. After `loadOwnedPlanningSession`, look up the Planner persona by slug, store personaId on the session, and include personaConfig in the nudge:

```typescript
export async function planSessionStart(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    workspaceId: string;
    projectId: string;
    projectName: string;
    workingDirectory: string;
    launchContext?: {
      intent: "shape" | "breakdown";
      notes: string;
      workItem?: {
        id: string;
        identifier: string;
        title: string;
        kind: string;
      };
      selectedRepoSources: Array<{
        id: string;
        label: string;
        path: string;
        detail: string;
      }>;
      attachedFiles: Array<{
        name: string;
        sizeLabel: string;
        content?: string;
      }>;
    };
  },
) {
  await loadOwnedPlanningSession(ctx.db, ctx.userId, input.sessionId);

  // Resolve Planner persona by slug (graceful fallback if not found)
  const [plannerPersona] = await ctx.db
    .select()
    .from(agentPersonas)
    .where(
      and(
        eq(agentPersonas.slug, "planner"),
        eq(agentPersonas.active, true),
      ),
    )
    .limit(1);

  const agentType = plannerPersona?.adapterId ?? "claude";
  const personaConfig = plannerPersona
    ? {
        model: plannerPersona.model,
        systemPrompt: plannerPersona.systemPrompt,
        allowedTools: plannerPersona.allowedTools as string[] | undefined,
        autonomyLevel: plannerPersona.autonomyLevel,
        metadata: plannerPersona.metadata as Record<string, unknown> | undefined,
      }
    : undefined;

  await ctx.db
    .update(chatConversations)
    .set({
      status: "pending",
      workingDirectory: input.workingDirectory,
      agentType,
      planningWorkspaceId: input.workspaceId,
      planningProjectId: input.projectId,
      planningProjectName: input.projectName,
      planningLaunchContext: input.launchContext ?? null,
      ...(plannerPersona ? { personaId: plannerPersona.id, personaMetadata: personaConfig } : {}),
    } as any)
    .where(eq(chatConversations.id, input.sessionId));

  const gatewayUrl = process.env.GATEWAY_URL;
  const nudgeSecret = process.env.NUDGE_SHARED_SECRET;
  if (gatewayUrl && nudgeSecret) {
    try {
      await fetch(`${gatewayUrl}/internal/nudge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nudgeSecret}`,
        },
        body: JSON.stringify({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          workingDirectory: input.workingDirectory,
          agentType,
          title: "Planning session",
          sessionType: "planning",
          personaId: plannerPersona?.id,
          personaConfig,
          planningContext: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            projectName: input.projectName,
            launchContext: input.launchContext,
          },
        }),
      });
    } catch (err) {
      console.warn("[planSession.start] nudge failed:", err);
    }
  }

  return { ok: true, sessionId: input.sessionId };
}
```

**Step 3: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p packages/bob/tsconfig.json`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/bob/src/api/src/handlers/planSession.ts
git commit -m "feat(planning): resolve Planner persona in planSessionStart"
```

---

### Task 8: Delete dead planning code

**Files:**
- Delete: `apps/bob-execution/src/planning/startPlanningSession.ts`
- Delete: `apps/bob-execution/src/planning/smolAgentShapeProfile.ts`
- Delete: `apps/bob-execution/src/planning/smolAgentPlanningProfile.ts`
- Delete: `apps/bob-execution/src/planning/planningAgentTools.ts`
- Delete: `apps/bob-execution/src/planning/smolAgentReviewProfile.ts`
- Delete: `apps/bob-execution/src/planning/__tests__/smolAgentShapeProfile.test.ts`
- Delete: `apps/bob-execution/src/planning/__tests__/smolAgentPlanningProfile.test.ts`
- Delete: `apps/bob-execution/src/planning/__tests__/planningAgentTools.test.ts`
- Delete: `apps/bob-execution/src/planning/__tests__/smolAgentReviewProfile.test.ts`
- Possibly modify: `packages/bob/src/api/src/handlers/dispatch.ts` (remove smolAgentReviewProfile import)
- Possibly modify: `apps/bob-execution/src/runtime/index.ts` (remove smolAgentProfile re-export)

`startPlanningSession()` has zero callers. All smol-agent profile files are only used by it or by each other's tests. `planningAgentTools` is only imported by `startPlanningSession`.

**Step 1: Verify zero callers (safety check)**

Run: `grep -r "startPlanningSession\|smolAgentShapeProfile\|smolAgentPlanningProfile\|planningAgentTools" /Volumes/dev/bob/bob --include="*.ts" -l | grep -v "__tests__" | grep -v "planning/"`

Expected: Only `dispatch.ts` (smolAgentReviewProfile) and `runtime/index.ts` (smolAgentProfile). These need updating.

**Step 2: Clean up dispatch.ts**

In `packages/bob/src/api/src/handlers/dispatch.ts`, remove the import of `smolAgentReviewProfile` (line 153). Check what it's used for — if it's a dynamic import string, just remove that entry.

**Step 3: Clean up runtime/index.ts**

In `apps/bob-execution/src/runtime/index.ts`, remove the `export * from "./smolAgentProfile"` line.

**Step 4: Delete the files**

```bash
rm apps/bob-execution/src/planning/startPlanningSession.ts
rm apps/bob-execution/src/planning/smolAgentShapeProfile.ts
rm apps/bob-execution/src/planning/smolAgentPlanningProfile.ts
rm apps/bob-execution/src/planning/planningAgentTools.ts
rm apps/bob-execution/src/planning/smolAgentReviewProfile.ts
rm apps/bob-execution/src/planning/__tests__/smolAgentShapeProfile.test.ts
rm apps/bob-execution/src/planning/__tests__/smolAgentPlanningProfile.test.ts
rm apps/bob-execution/src/planning/__tests__/planningAgentTools.test.ts
rm apps/bob-execution/src/planning/__tests__/smolAgentReviewProfile.test.ts
```

Keep `savePlanningArtifact.ts` and its test — those may still be used.

**Step 5: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p apps/bob-execution/tsconfig.json && pnpm exec tsc --noEmit -p packages/bob/tsconfig.json`
Expected: No errors

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead smol-agent planning code (replaced by persona system)"
```

---

### Task 9: Create persona YAML files

**Files:**
- Create: `docs/personas/planner.yaml`
- Create: `docs/personas/growth-agent.yaml`
- Create: `docs/personas/compliance-agent.yaml`
- Create: `docs/personas/devops-agent.yaml`
- Create: `docs/personas/research-agent.yaml`

These define the five personas. They live in `docs/personas/` for now and will later be moved to the `gmacko-ops` repo.

**Step 1: Create planner.yaml**

The Planner persona focuses on analysis — no tool descriptions (planning tool interception was never built). It analyzes codebases and creates structured task breakdowns that users commit to Linear via Blder UI.

```yaml
apiVersion: v1
name: Planner
slug: planner
description: Analyzes codebases and creates structured work breakdowns with draft tasks
adapter: claude
model: claude-sonnet-4-6
autonomy_level: draft

system_prompt: |
  You are a planning agent. Your job is to analyze codebases, understand the current state,
  and create structured, actionable task breakdowns.

  You handle two planning intents:
  - shape: Analyze a rough idea or initiative and produce a high-level work breakdown
  - breakdown: Take shaped work items and create detailed, executable draft tasks

  For each task you propose:
  - Give it a clear, descriptive title
  - Write a description with acceptance criteria
  - Estimate complexity (small / medium / large)
  - Note dependencies on other tasks
  - Each task should be completable by an AI coding agent in a single session

  Output your plan as a structured document with numbered tasks, grouped by phase.
  Start with a brief analysis of the current codebase state relevant to the work.

allowed_tools:
  - Read
  - Glob
  - Grep
  - Bash
  - WebSearch
```

**Step 2: Create growth-agent.yaml**

```yaml
apiVersion: v1
name: Growth Agent
slug: growth-agent
description: Drives user acquisition, activation, and retention across portfolio startups
adapter: claude
model: claude-sonnet-4-6
autonomy_level: safe_execute

system_prompt: |
  You are a growth agent for the portfolio. You use the Pulse CLI to analyze growth
  metrics, identify bottlenecks, and execute approved growth initiatives.

  Always use --json for machine-readable output from Pulse CLI.

  Key commands:
  - pulse status --json — portfolio overview
  - pulse growth review --startup <slug> --json — growth analysis
  - pulse growth bottlenecks --startup <slug> --json — identify blockers
  - pulse campaigns list --startup <slug> --json — active campaigns
  - pulse actions list --startup <slug> --json — pending actions
  - pulse actions execute-next --startup <slug> --target <system> --json — execute next action

  Before executing any action, check its risk level:
  - "read" or "safe_write": Execute autonomously
  - "external_write" or "dangerous_write": Report findings and stop

  Always start by running `pulse status --json` to get portfolio context.

allowed_tools:
  - Read
  - Bash
  - WebSearch
  - WebFetch

metadata:
  bizpulse:
    agentSlug: growth-agent
    apiUrl: https://bizpulse.cc
```

**Step 3: Create compliance-agent.yaml**

```yaml
apiVersion: v1
name: Compliance Agent
slug: compliance-agent
description: Audits entity compliance, integration health, and setup completeness
adapter: claude
model: claude-sonnet-4-6
autonomy_level: recommend

system_prompt: |
  You are a compliance agent. You use the Pulse CLI to audit business entity
  compliance, integration health, and setup completeness.

  Always use --json for machine-readable output.

  Key commands:
  - pulse entity show <startup> — business entity details
  - pulse entity compliance — compliance status across portfolio
  - pulse integrations audit --all --json — integration health audit
  - pulse integrations setup --all --checklist --json — setup checklist
  - pulse alerts --json — current alerts

  You operate in recommend mode: analyze, identify issues, and propose actions.
  Never execute actions directly. Report your findings with specific recommendations.

allowed_tools:
  - Read
  - Bash
  - WebSearch

metadata:
  bizpulse:
    agentSlug: compliance-agent
    apiUrl: https://bizpulse.cc
```

**Step 4: Create devops-agent.yaml**

```yaml
apiVersion: v1
name: DevOps Agent
slug: devops-agent
description: Manages deployments, syncs, alert triage, and infrastructure changes
adapter: claude
model: claude-sonnet-4-6
autonomy_level: safe_execute

system_prompt: |
  You are a DevOps agent. You handle deployments, integration syncs, alert triage,
  and can make code changes (bug fixes, config updates).

  Always use --json for machine-readable output from Pulse CLI.

  Key commands:
  - pulse deploy <startup> <stage> — trigger deployment
  - pulse sync <integration> <startup> — trigger data sync
  - pulse alerts --json — current alerts
  - pulse alerts -s <startup-slug> — startup-specific alerts
  - pulse status --json — portfolio health overview

  Valid sync integrations: stripe, sentry, posthog, mercury, forgegraph, twenty, quickbooks, cloudflare

  You can also make code changes using Read, Write, Edit, Bash, Grep, Glob tools.
  Create commits for any code changes and push when ready.

allowed_tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob

metadata:
  bizpulse:
    agentSlug: devops-agent
    apiUrl: https://bizpulse.cc
```

**Step 5: Create research-agent.yaml**

```yaml
apiVersion: v1
name: Research Agent
slug: research-agent
description: Portfolio analysis, market research, and competitive intelligence
adapter: claude
model: claude-sonnet-4-6
autonomy_level: observe

system_prompt: |
  You are a research agent. You analyze portfolio status, conduct market research,
  and gather competitive intelligence. You are read-only — you report findings
  but never execute actions or make changes.

  Always use --json for machine-readable output from Pulse CLI.

  Key commands:
  - pulse status --json — portfolio overview with ops scores
  - pulse startup list --json — all startups
  - pulse startup show <slug> — startup details
  - pulse startup gtm --all --json — go-to-market status
  - pulse startup gates --all --json — launch gate status
  - pulse growth review --startup <slug> --json — growth analysis

  Report your findings in structured format:
  1. Executive summary
  2. Key metrics and trends
  3. Risks and opportunities
  4. Recommended next steps (for human review)

allowed_tools:
  - Read
  - Bash
  - WebSearch
  - WebFetch

metadata:
  bizpulse:
    agentSlug: research-agent
    apiUrl: https://bizpulse.cc
```

**Step 6: Commit**

```bash
git add docs/personas/
git commit -m "feat(personas): add five persona YAML definitions"
```

---

### Task 10: Implement persona sync from YAML directory

**Files:**
- Modify: `packages/bob/src/api/src/handlers/persona.ts` (add personaSyncFromDirectory)
- Modify: `packages/bob/src/api/src/rpc-handlers/persona.ts` (wire syncRepo RPC)

**Step 1: Check if js-yaml is available**

Run: `grep -r "js-yaml" /Volumes/dev/bob/bob/package.json /Volumes/dev/bob/bob/packages/*/package.json 2>/dev/null`

If not present, add it:

Run: `cd /Volumes/dev/bob/bob && pnpm add js-yaml @types/js-yaml --filter @bob/api`

**Step 2: Implement personaSyncFromDirectory**

Add to `packages/bob/src/api/src/handlers/persona.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import yaml from "js-yaml";

interface PersonaYaml {
  apiVersion: string;
  name: string;
  slug: string;
  description?: string;
  adapter: string;
  model?: string;
  autonomy_level?: string;
  system_prompt?: string;
  allowed_tools?: string[];
  metadata?: Record<string, unknown>;
}

export async function personaSyncFromDirectory(
  ctx: HandlerContext,
  input: { directory: string },
): Promise<{ created: number; updated: number; unchanged: number }> {
  const files = await readdir(input.directory);
  const yamlFiles = files.filter((f) => extname(f) === ".yaml" || extname(f) === ".yml");

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const syncedSlugs: string[] = [];

  for (const file of yamlFiles) {
    const content = await readFile(join(input.directory, file), "utf-8");
    const parsed = yaml.load(content) as PersonaYaml;

    if (!parsed?.slug || !parsed?.name || !parsed?.adapter) {
      console.warn(`[persona-sync] Skipping invalid YAML: ${file}`);
      continue;
    }

    syncedSlugs.push(parsed.slug);

    const existing = await ctx.db
      .select()
      .from(agentPersonas)
      .where(
        and(
          eq(agentPersonas.tenantId, ctx.tenantId),
          eq(agentPersonas.slug, parsed.slug),
          eq(agentPersonas.source, "repo"),
        ),
      )
      .limit(1);

    const values = {
      tenantId: ctx.tenantId,
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description ?? null,
      adapterId: parsed.adapter,
      model: parsed.model ?? null,
      systemPrompt: parsed.system_prompt ?? null,
      allowedTools: parsed.allowed_tools ?? null,
      autonomyLevel: parsed.autonomy_level ?? null,
      source: "repo" as const,
      active: true,
      metadata: parsed.metadata ?? {},
      updatedAt: new Date(),
    };

    if (existing[0]) {
      const ex = existing[0];
      const changed =
        ex.name !== values.name ||
        ex.description !== values.description ||
        ex.adapterId !== values.adapterId ||
        ex.model !== values.model ||
        ex.systemPrompt !== values.systemPrompt ||
        JSON.stringify(ex.allowedTools) !== JSON.stringify(values.allowedTools) ||
        ex.autonomyLevel !== values.autonomyLevel ||
        JSON.stringify(ex.metadata) !== JSON.stringify(values.metadata);

      if (changed) {
        await ctx.db
          .update(agentPersonas)
          .set(values)
          .where(eq(agentPersonas.id, ex.id));
        updated++;
      } else {
        unchanged++;
      }
    } else {
      await ctx.db
        .insert(agentPersonas)
        .values(values);
      created++;
    }
  }

  // Soft-delete repo personas whose slug is no longer in the directory
  const allRepoPersonas = await ctx.db
    .select({ id: agentPersonas.id, slug: agentPersonas.slug })
    .from(agentPersonas)
    .where(
      and(
        eq(agentPersonas.tenantId, ctx.tenantId),
        eq(agentPersonas.source, "repo"),
        eq(agentPersonas.active, true),
      ),
    );

  for (const persona of allRepoPersonas) {
    if (!syncedSlugs.includes(persona.slug)) {
      await ctx.db
        .update(agentPersonas)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(agentPersonas.id, persona.id));
    }
  }

  console.log(`[persona-sync] Sync complete: ${created} created, ${updated} updated, ${unchanged} unchanged`);
  return { created, updated, unchanged };
}
```

**Step 3: Wire syncRepo RPC handler**

In `packages/bob/src/api/src/rpc-handlers/persona.ts`, update the `persona.syncRepo` handler:

```typescript
import { personaSyncFromDirectory } from "../handlers/persona.js";
import { join } from "node:path";

// ... in makePersonaRpcHandlers:

"persona.syncRepo": () =>
  Effect.gen(function* () {
    const personasDir = process.env.BOB_PERSONAS_DIR ?? join(process.cwd(), "docs/personas");
    const result = yield* wrapHandler(personaSyncFromDirectory, ctx, { directory: personasDir }, "persona");
    return result;
  }),
```

**Step 4: Verify it compiles**

Run: `cd /Volumes/dev/bob/bob && pnpm exec tsc --noEmit -p packages/bob/tsconfig.json`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/bob/src/api/src/handlers/persona.ts packages/bob/src/api/src/rpc-handlers/persona.ts
git commit -m "feat(persona): implement YAML directory sync + wire syncRepo RPC"
```

---

### Task 11: Add BizPulse REST endpoint for session reporting

**Files:**
- Create: `packages/api/src/app/api/agent/report-session/route.ts` (in the BizPulse repo at `/Volumes/dev/bizpulse/pulse`)

This task is in the **BizPulse** codebase, not Bob. The daemon sends session reports via `POST /api/agent/report-session` as plain REST (not tRPC). The endpoint auto-creates agent records on first report.

**Step 1: Locate the right directory for Next.js API routes**

Run: `find /Volumes/dev/bizpulse/pulse -path "*/app/api" -type d | head -5`

**Step 2: Create the REST endpoint**

The endpoint should:
1. Validate the `Authorization: Bearer <PULSE_API_KEY>` header
2. Parse the JSON body with fields: `agentSlug`, `externalSessionId`, `startupSlug?`, `title?`, `status`, `inputTokens`, `outputTokens`, `cacheReadTokens?`, `cacheCreationTokens?`, `costMicrocents`, `durationMs`, `summary?`
3. Look up the agent by slug — if not found, auto-create it
4. Upsert an `agentSession` record keyed on `(agentId, externalSessionId)`
5. Return `{ ok: true, agentSessionId: ... }`

The exact implementation depends on BizPulse's schema and patterns — consult:
- `packages/db/src/pulse-schema.ts` — `agent` and `agentSession` tables
- `packages/api/src/router/agent.ts` — existing tRPC `reportSession` mutation for reference
- Check if the schema needs `cacheReadTokens`/`cacheCreationTokens` columns added to `agentSession`

**Step 3: Add token breakdown columns to agentSession (if needed)**

The existing `agentSession.tokensUsed` is a single int. Add:
```sql
input_tokens integer
output_tokens integer
cache_read_tokens integer
cache_creation_tokens integer
```

Run `drizzle-kit push` in the BizPulse repo after schema changes.

**Step 4: Verify**

Run: `cd /Volumes/dev/bizpulse/pulse && pnpm exec tsc --noEmit`
Expected: No errors

**Step 5: Commit (in BizPulse repo)**

```bash
cd /Volumes/dev/bizpulse/pulse
git add -A
git commit -m "feat(agent): add REST endpoint POST /api/agent/report-session with auto-create"
```

---

### Task 12: End-to-end verification

**Step 1: Run drizzle-kit push for agent_personas table**

The `agent_personas` table may not exist in the DB yet. Push the schema:

Run: `cd /Volumes/dev/bob/bob && pnpm exec drizzle-kit push`

**Step 2: Run full type check**

Run: `cd /Volumes/dev/bob/bob && pnpm exec turbo run typecheck`
Expected: All packages pass

**Step 3: Run existing tests**

Run: `cd /Volumes/dev/bob/bob && pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism`
Expected: No new test failures (existing 6 known failures are acceptable)

**Step 4: Verify persona sync works**

Once the Bob API server is running:
1. Set `BOB_PERSONAS_DIR` to point at `docs/personas/`
2. Set `BOB_TENANT_ID` to a valid tenant UUID
3. Call `agent.persona.syncRepo` RPC
4. Verify 5 personas appear in DB with `source: "repo"`
5. Verify they have correct system prompts, tools, and metadata

**Step 5: Verify daemon handles planning sessions**

1. Create a planning session via `planSessionStart` in Blder
2. Verify the session has `personaId` pointing to the Planner persona
3. Verify the gateway forwards `personaConfig` in the nudge
4. Verify the daemon picks it up (no longer skips)
5. Verify the prompt includes planning context

**Step 6: Verify BizPulse reporting**

1. Create a session with a BizPulse persona (e.g., growth-agent)
2. Verify `PULSE_API_KEY` and `PULSE_API_URL` are in the subprocess env
3. On session close, verify `reportToBizPulse` fires and BizPulse receives the report
4. Verify the BizPulse REST endpoint auto-creates the agent record

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: agent operations integration — personas, planning migration, Pulse CLI, BizPulse reporting"
```

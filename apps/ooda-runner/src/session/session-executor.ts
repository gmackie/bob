import { existsSync } from "node:fs";

import type { AgentAdapter, AdapterEvent } from "@gmacko/ooda/agent-adapters";
import {
  createBuddyToolDescriptors,
  registerTools,
  type ToolDescriptor,
} from "@gmacko/ooda/agent-adapters";
import type {
  BudgetState,
  HandlerContext,
  ResearchTRPCSurface,
} from "@gmacko/ooda/buddy-tools";
import { CapabilityRegistry } from "@gmacko/ooda/capability-registry";
import { createThreadWorkspace } from "@gmacko/ooda/thread-workspace";
import { resolveThreadPath } from "@gmacko/ooda/thread-model";

import { extractAgentResponse } from "../pty-output-parser";

// Default per-session tool budget (mirrors the buddy-tools design doc:
// budget_seconds=180, max_s2_requests=200; tokens are runner-owned and not
// decremented by the tool middleware, so we seed a generous ceiling).
const DEFAULT_TOOL_BUDGET: Readonly<BudgetState> = {
  tokens: 1_000_000,
  wallClockMs: 180_000,
  s2Requests: 200,
};

export interface SessionExecutorConfig {
  adapter: AgentAdapter;
  storageRoot: string;
  /**
   * tRPC research surface the buddy-tool handlers call. When provided (and
   * the input carries a `threadId`), the executor builds + registers buddy
   * tool descriptors on the adapter so the agent can invoke them mid-session.
   * When omitted, tool registration is skipped (the adapter runs tool-less).
   */
  research?: ResearchTRPCSurface;
  /**
   * Capability registry used to gate the exposed tool set by
   * `toolProfileId`. If it has no tool capabilities for the profile (the
   * unseeded default), the executor falls back to the full implemented set.
   */
  capabilityRegistry?: CapabilityRegistry;
}

export interface ExecuteSessionInput {
  threadSlug: string;
  threadTitle: string;
  sessionId: string;
  prompt: string;
  toolProfileId: string;
  /**
   * Thread id the buddy-tool handlers thread through their tRPC calls.
   * Required for tool registration; when absent, tools are not registered.
   */
  threadId?: string;
  systemPrompt?: string;
  onEvent: (event: AdapterEvent) => void;
}

export interface ExecuteSessionResult {
  exitCode: number;
  threadDir: string;
  rawOutput: string;
  agentResponse: string;
}

export class SessionExecutor {
  private adapter: AgentAdapter;
  private storageRoot: string;
  private research?: ResearchTRPCSurface;
  private capabilityRegistry?: CapabilityRegistry;

  constructor(config: SessionExecutorConfig) {
    this.adapter = config.adapter;
    this.storageRoot = config.storageRoot;
    this.research = config.research;
    this.capabilityRegistry = config.capabilityRegistry;
  }

  async execute(input: ExecuteSessionInput): Promise<ExecuteSessionResult> {
    const threadDir = resolveThreadPath(this.storageRoot, input.threadSlug);

    // Ensure workspace exists
    if (!existsSync(threadDir)) {
      await createThreadWorkspace({
        storageRoot: this.storageRoot,
        slug: input.threadSlug,
        title: input.threadTitle,
      });
    }

    // Build a HandlerContext + session budget and register the (profile-
    // gated) buddy tool descriptors on the adapter before execute. Adapters
    // that speak ACP (Grok) consume these so the agent can call buddy tools
    // mid-session; CLI-spawn adapters ignore the registration (no-op).
    this.registerBuddyTools(input);

    // Build command
    const command = this.adapter.buildCommand({
      prompt: input.prompt,
      workspaceRoot: threadDir,
      systemPrompt: input.systemPrompt,
    });

    // Capture output
    let fullOutput = "";

    const wrappedOnEvent = (event: AdapterEvent) => {
      // Capture assistant text (stdout) for the parsed agentResponse.
      // Structured ACP events (thought / tool_call / tool_result) pass
      // through to the caller untouched for richer session reporting.
      if (event.type === "stdout") {
        fullOutput += event.data;
      }
      input.onEvent(event);
    };

    // Execute
    const result = await this.adapter.execute(command, wrappedOnEvent);

    return {
      exitCode: result.exitCode,
      threadDir,
      rawOutput: fullOutput,
      agentResponse: extractAgentResponse(fullOutput),
    };
  }

  /**
   * Build + register buddy tool descriptors for this session, gated by the
   * session's tool profile. No-op unless a research surface is configured
   * and the input carries a threadId (the handlers need both to run).
   */
  private registerBuddyTools(input: ExecuteSessionInput): void {
    if (!this.research || !input.threadId) return;

    const ctx: HandlerContext = {
      threadId: input.threadId,
      runnerSessionId: input.sessionId,
      trpc: { research: this.research },
    };

    // Fresh mutable budget per session so one session's spend can't bleed
    // into the next.
    const budget: BudgetState = { ...DEFAULT_TOOL_BUDGET };

    let descriptors: ToolDescriptor[] = createBuddyToolDescriptors(ctx, {
      budget,
    });

    // Gate by tool profile. An unseeded registry (no tool capabilities for
    // this profile) falls through to the full implemented set so the default
    // path is never accidentally starved of tools.
    const allowed = this.allowedToolNames(input.toolProfileId);
    if (allowed) {
      descriptors = descriptors.filter((d) => allowed.has(d.name));
    }

    registerTools(this.adapter, descriptors);
  }

  /**
   * Resolve the tool-name allowlist for a profile from the capability
   * registry, or `null` to mean "no gating — expose all implemented tools".
   * Capability ids may carry a `tool:` prefix (e.g. `tool:papers_search`).
   */
  private allowedToolNames(toolProfileId: string): Set<string> | null {
    if (!this.capabilityRegistry) return null;
    const toolCaps = this.capabilityRegistry
      .listForProfile(toolProfileId)
      .filter((c) => c.kind === "tool");
    if (toolCaps.length === 0) return null;
    return new Set(toolCaps.map((c) => c.id.replace(/^tool:/, "")));
  }
}

import { existsSync } from "node:fs";

import type { AgentAdapter, AdapterEvent } from "@gmacko/ooda/agent-adapters";
import { createThreadWorkspace } from "@gmacko/ooda/thread-workspace";
import { resolveThreadPath } from "@gmacko/ooda/thread-model";

import { extractAgentResponse } from "../pty-output-parser";

export interface SessionExecutorConfig {
  adapter: AgentAdapter;
  storageRoot: string;
}

export interface ExecuteSessionInput {
  threadSlug: string;
  threadTitle: string;
  sessionId: string;
  prompt: string;
  toolProfileId: string;
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

  constructor(config: SessionExecutorConfig) {
    this.adapter = config.adapter;
    this.storageRoot = config.storageRoot;
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

    // TODO(acp): When the ACP dispatcher lands, build a HandlerContext
    // + session BudgetState here and register buddy tool descriptors on
    // the adapter before execute:
    //
    //   import { createBuddyToolDescriptors, registerTools }
    //     from "@gmacko/ooda/agent-adapters";
    //   const descriptors = createBuddyToolDescriptors(ctx, { budget });
    //   registerTools(this.adapter, descriptors);
    //
    // Today the CLI-spawn adapters have no channel to receive these, so
    // the call is intentionally omitted (it would be a no-op).

    // Build command
    const command = this.adapter.buildCommand({
      prompt: input.prompt,
      workspaceRoot: threadDir,
      systemPrompt: input.systemPrompt,
    });

    // Capture output
    let fullOutput = "";

    const wrappedOnEvent = (event: AdapterEvent) => {
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
}

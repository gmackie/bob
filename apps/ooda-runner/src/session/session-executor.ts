import { existsSync } from "node:fs";

import type { AgentAdapter, AdapterEvent } from "@gmacko/ooda/agent-adapters";
import { createThreadWorkspace } from "@gmacko/ooda/thread-workspace";
import { resolveThreadPath } from "@gmacko/ooda/thread-model";

import { extractAgentResponse } from "../pty-output-parser";
import {
  buildOodaT3ThreadTurnStartCommand,
  dispatchOodaSessionToT3Code,
  type OodaT3DispatchRuntimeConfig,
} from "./t3-dispatch";

export interface SessionExecutorConfig {
  adapter: AgentAdapter;
  storageRoot: string;
  t3code?: OodaT3DispatchRuntimeConfig & {
    worktreePath?: string;
    dispatch?: (command: Record<string, unknown>) => Promise<unknown>;
  };
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
  dispatchedToT3Code?: boolean;
}

export class SessionExecutor {
  private adapter: AgentAdapter;
  private storageRoot: string;
  private t3code?: SessionExecutorConfig["t3code"];

  constructor(config: SessionExecutorConfig) {
    this.adapter = config.adapter;
    this.storageRoot = config.storageRoot;
    this.t3code = config.t3code;
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

    if (this.t3code) {
      const t3WorkspaceRoot = this.t3code.worktreePath ?? threadDir;
      const command = buildOodaT3ThreadTurnStartCommand({
        threadId: input.threadSlug,
        threadSlug: input.threadSlug,
        threadTitle: input.threadTitle,
        sessionId: input.sessionId,
        prompt: input.prompt,
        workspaceRoot: t3WorkspaceRoot,
        externalTask: {
          origin: "ooda",
          oodaThreadId: input.threadSlug,
          oodaThreadSlug: input.threadSlug,
          oodaSessionId: input.sessionId,
        },
        config: this.t3code,
        makeId: (prefix) =>
          prefix === "thread"
            ? `ooda-session-${input.sessionId}`
            : `${prefix}-${input.sessionId}`,
      });

      if (this.t3code.dispatch) {
        await this.t3code.dispatch(command);
      } else {
        await dispatchOodaSessionToT3Code({
          serverUrl: this.t3code.serverUrl,
          authToken: this.t3code.authToken,
          command,
        });
      }

      const message = `Dispatched OODA session to t3code thread ${command.threadId}`;
      input.onEvent({
        type: "stdout",
        data: message,
        timestamp: new Date().toISOString(),
      });

      return {
        exitCode: 0,
        threadDir,
        rawOutput: message,
        agentResponse: message,
        dispatchedToT3Code: true,
      };
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

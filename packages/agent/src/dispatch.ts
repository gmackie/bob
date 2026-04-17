import Anthropic from "@anthropic-ai/sdk";
import { Effect } from "effect";

const client = new Anthropic();

export interface DispatchOptions {
  threadId: string;
  branchId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt?: string;
}

export interface TextChunk {
  type: "text";
  text: string;
}

export interface DoneEvent {
  type: "done";
  content: string;
  usage: { input_tokens: number; output_tokens: number };
}

export type AgentEvent = TextChunk | DoneEvent;

export async function* dispatchAgent(
  opts: DispatchOptions,
): AsyncGenerator<AgentEvent> {
  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system:
      opts.systemPrompt ??
      "You are a research assistant. Help the user explore ideas, find connections, and build understanding. Be thorough and curious.",
    messages: opts.messages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", text: event.delta.text };
    }
  }

  const finalMessage = await stream.finalMessage();
  yield {
    type: "done",
    content: finalMessage.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(""),
    usage: finalMessage.usage,
  };
}

export const dispatchAgentEffect = (
  opts: DispatchOptions,
): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      let content = "";
      for await (const event of dispatchAgent(opts)) {
        if (event.type === "done") content = event.content;
      }
      return content;
    },
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  });

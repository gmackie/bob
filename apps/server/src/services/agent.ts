import { Effect, Layer, ServiceMap } from "effect";
import { dispatchAgent } from "@gmacko/agent";

export class AgentService extends ServiceMap.Service<
  AgentService,
  {
    /**
     * Dispatch agent and collect the full response (non-streaming).
     * Returns the final content string.
     */
    readonly chat: (input: {
      threadId: string;
      branchId: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      systemPrompt?: string;
    }) => Effect.Effect<string, Error>;
  }
>()("@gmacko/server/AgentService") {}

export const AgentServiceLive = Layer.succeed(AgentService)({
  chat: (input) =>
    Effect.tryPromise({
      try: async () => {
        let finalContent = "";
        for await (const event of dispatchAgent({
          threadId: input.threadId,
          branchId: input.branchId,
          messages: input.messages,
          systemPrompt: input.systemPrompt,
        })) {
          if (event.type === "done") {
            finalContent = event.content;
          }
        }
        return finalContent;
      },
      catch: (error) => new Error(`Agent dispatch failed: ${error}`),
    }),
});

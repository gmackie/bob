import type { ConversationEventV1 } from "@gmacko/ooda/contracts/v1";

import type { ConversationEventStreamRequestV1 } from "./client";

export interface SseMessageV1 {
  event: string;
  data: string;
}

export interface SseReadResultV1 {
  messages: SseMessageV1[];
  rest: string;
}

export function readSseMessages(input: string): SseReadResultV1 {
  const parts = input.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  const messages: SseMessageV1[] = [];

  for (const block of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      let value = separator === -1 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      if (field === "data") data.push(value);
    }
    if (data.length > 0) messages.push({ event, data: data.join("\n") });
  }

  return { messages, rest };
}

type StreamFetchV1 = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface StreamConversationEventsOptionsV1 {
  signal: AbortSignal;
  createRequest: (
    afterSequence?: string,
  ) => Promise<ConversationEventStreamRequestV1>;
  onEvent: (event: ConversationEventV1) => void;
  onConnectionChange?: (connected: boolean) => void;
  onProblem?: (problem: unknown) => void;
  initialAfterSequence?: string;
  reconnectDelayMs?: number;
  fetchImpl?: StreamFetchV1;
}

function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isNewerSequence(candidate: string, cursor?: string): boolean {
  if (!/^\d+$/.test(candidate)) return false;
  return !cursor || BigInt(candidate) > BigInt(cursor);
}

export async function streamConversationEvents(
  options: StreamConversationEventsOptionsV1,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? 750;
  let afterSequence = options.initialAfterSequence;

  while (!options.signal.aborted) {
    try {
      const request = await options.createRequest(afterSequence);
      const response = await fetchImpl(request.url, {
        headers: request.headers,
        signal: options.signal,
      });
      const reader = response.body?.getReader();
      if (!response.ok || !reader) {
        throw new Error(
          `OODA event stream failed with status ${response.status}`,
        );
      }

      options.onConnectionChange?.(true);
      const decoder = new TextDecoder();
      let buffer = "";
      while (!options.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = readSseMessages(buffer);
        buffer = parsed.rest;

        for (const message of parsed.messages) {
          if (message.event === "problem") {
            try {
              options.onProblem?.(JSON.parse(message.data) as unknown);
            } catch {
              options.onProblem?.(message.data);
            }
            continue;
          }
          if (message.event !== "conversation_event") continue;
          try {
            const event = JSON.parse(message.data) as ConversationEventV1;
            if (!isNewerSequence(event.sequence, afterSequence)) continue;
            afterSequence = event.sequence;
            options.onEvent(event);
            if (options.signal.aborted) break;
          } catch {
            // Reconnect from the last valid sequence after malformed frames.
          }
        }
      }
    } catch (error) {
      if (!options.signal.aborted) options.onProblem?.(error);
    } finally {
      options.onConnectionChange?.(false);
    }

    await waitForReconnect(reconnectDelayMs, options.signal);
  }
}

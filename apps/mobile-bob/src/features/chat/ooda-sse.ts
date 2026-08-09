export interface SseMessage {
  event: string;
  data: string;
}

export interface SseReadResult {
  messages: SseMessage[];
  rest: string;
}

export function readSseMessages(input: string): SseReadResult {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const messages: SseMessage[] = [];

  for (const block of parts) {
    let event = "message";
    const data: string[] = [];

    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;

      const separatorIndex = line.indexOf(":");
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "event") event = value;
      if (field === "data") data.push(value);
    }

    if (data.length > 0) {
      messages.push({ event, data: data.join("\n") });
    }
  }

  return { messages, rest };
}

type StreamFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface StreamConversationEventsOptions {
  signal: AbortSignal;
  createRequest: (
    afterSequence?: string,
  ) => Promise<ConversationEventStreamRequestV1>;
  onEvent: (event: ConversationEventV1) => void;
  onConnectionChange?: (connected: boolean) => void;
  onProblem?: (problem: unknown) => void;
  initialAfterSequence?: string;
  reconnectDelayMs?: number;
  fetchImpl?: StreamFetch;
}

function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function isNewerSequence(candidate: string, cursor?: string): boolean {
  if (!/^\d+$/.test(candidate)) return false;
  return !cursor || BigInt(candidate) > BigInt(cursor);
}

export async function streamConversationEvents(
  options: StreamConversationEventsOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? 750;
  let afterSequence = options.initialAfterSequence;
  const isAborted = () => options.signal.aborted;

  while (!isAborted()) {
    try {
      const request = await options.createRequest(afterSequence);
      const response = await fetchImpl(request.url, {
        headers: request.headers,
        signal: options.signal,
      });
      const reader = response.body?.getReader();
      if (!response.ok || !reader) {
        throw new Error(`OODA event stream failed with status ${response.status}`);
      }

      options.onConnectionChange?.(true);
      const decoder = new TextDecoder();
      let buffer = "";

      while (!isAborted()) {
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
            if (isAborted()) break;
          } catch {
            // Ignore malformed frames; the next reconnect resumes from the last
            // valid sequence and the server remains the source of truth.
          }
        }
      }
    } catch (error) {
      if (!isAborted()) options.onProblem?.(error);
    } finally {
      options.onConnectionChange?.(false);
    }

    await waitForReconnect(reconnectDelayMs, options.signal);
  }
}
import type {
  ConversationEventStreamRequestV1,
  ConversationEventV1,
} from "@gmacko/ooda-client/v1";

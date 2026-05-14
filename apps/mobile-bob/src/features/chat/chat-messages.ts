export type ChatMode = "bob" | "ooda";
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  mode: ChatMode;
  role: ChatRole;
  content: string;
  timestamp: string;
  sourceId: string;
}

export interface BobChatEvent {
  sessionId: string;
  seq: number;
  eventType: string;
  direction: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface OodaSessionEvent {
  id: string;
  sessionId: string;
  type: string;
  content: string;
  createdAt: string | Date;
}

function payloadText(payload: Record<string, unknown>): string {
  for (const key of ["content", "text", "data", "chunk", "message"]) {
    const value = payload[key];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(payload);
}

export function collapseBobEventsToMessages(events: BobChatEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let pendingChunks: string[] = [];
  let pendingSeq = 0;
  let pendingTime = "";
  let pendingSessionId = "";

  const flushChunks = () => {
    if (!pendingChunks.length) return;
    messages.push({
      id: `bob:${pendingSessionId}:${pendingSeq}`,
      mode: "bob",
      role: "assistant",
      content: pendingChunks.join(""),
      timestamp: pendingTime,
      sourceId: pendingSessionId,
    });
    pendingChunks = [];
    pendingSeq = 0;
    pendingTime = "";
    pendingSessionId = "";
  };

  for (const event of events) {
    if (event.eventType === "input" && event.direction === "client") {
      flushChunks();
      messages.push({
        id: `bob:${event.sessionId}:${event.seq}`,
        mode: "bob",
        role: "user",
        content: payloadText(event.payload),
        timestamp: event.createdAt,
        sourceId: event.sessionId,
      });
      continue;
    }

    if (event.eventType === "output_chunk" && event.direction === "agent") {
      if (!pendingChunks.length) {
        pendingSeq = event.seq;
        pendingTime = event.createdAt;
        pendingSessionId = event.sessionId;
      }
      const chunk = payloadText(event.payload);
      if (chunk) pendingChunks.push(chunk);
      continue;
    }

    if (event.eventType === "message_final" && event.direction === "agent") {
      flushChunks();
      const content = payloadText(event.payload);
      if (content) {
        messages.push({
          id: `bob:${event.sessionId}:${event.seq}`,
          mode: "bob",
          role: "assistant",
          content,
          timestamp: event.createdAt,
          sourceId: event.sessionId,
        });
      }
      continue;
    }

    if (event.eventType === "error") {
      flushChunks();
      messages.push({
        id: `bob:${event.sessionId}:${event.seq}`,
        mode: "bob",
        role: "system",
        content: payloadText(event.payload),
        timestamp: event.createdAt,
        sourceId: event.sessionId,
      });
    }
  }

  flushChunks();
  return messages;
}

function eventTimestamp(event: OodaSessionEvent): string {
  return typeof event.createdAt === "string"
    ? event.createdAt
    : event.createdAt.toISOString();
}

export function collapseOodaEventsToMessages(
  sessionId: string,
  events: OodaSessionEvent[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const chunks = events.filter((event) => event.type === "stdout_chunk");
  const firstChunk = chunks[0];
  const stdoutFallback = events.find((event) => event.type === "stdout");

  for (const event of events) {
    if (event.type !== "prompt") continue;
    messages.push({
      id: `ooda:${sessionId}:${event.id}`,
      mode: "ooda",
      role: "user",
      content: event.content,
      timestamp: eventTimestamp(event),
      sourceId: sessionId,
    });
  }

  if (firstChunk) {
    messages.push({
      id: `ooda:${sessionId}:${firstChunk.id}`,
      mode: "ooda",
      role: "assistant",
      content: chunks.map((event) => event.content).join(""),
      timestamp: eventTimestamp(firstChunk),
      sourceId: sessionId,
    });
  } else if (stdoutFallback?.content) {
    messages.push({
      id: `ooda:${sessionId}:${stdoutFallback.id}`,
      mode: "ooda",
      role: "assistant",
      content: stdoutFallback.content,
      timestamp: eventTimestamp(stdoutFallback),
      sourceId: sessionId,
    });
  }

  const error = events.find((event) => event.type === "error");
  if (error) {
    messages.push({
      id: `ooda:${sessionId}:${error.id}`,
      mode: "ooda",
      role: "system",
      content: error.content,
      timestamp: eventTimestamp(error),
      sourceId: sessionId,
    });
  }

  return messages;
}

export function isPromotableMessage(message: ChatMessage): boolean {
  return (
    message.mode === "ooda" &&
    message.role === "assistant" &&
    message.content.trim().length > 0
  );
}

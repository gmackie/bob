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

// Minimal ACP (Agent Client Protocol) JSON-RPC 2.0 client.
//
// Transport-agnostic by design: it does not know about child processes.
// The caller supplies a `write` sink (-> agent stdin) and pushes incoming
// bytes via `feed` (<- agent stdout). This keeps the protocol logic unit
// testable without spawning a real agent.
//
// Framing: newline-delimited JSON objects (one JSON-RPC message per line).
//
// Three inbound shapes are handled:
//   - response    : { id, result | error }              -> resolves/rejects a pending request
//   - request     : { id, method, params }              -> answered via `onRequest`
//   - notification: { method, params }   (no id)        -> forwarded to `onNotification`

export interface AcpClientOptions {
  /** Write raw bytes to the agent's stdin (the client appends newlines itself). */
  write: (data: string) => void;
  /** Called for every inbound notification (a message with a method and no id). */
  onNotification: (method: string, params: unknown) => void;
  /**
   * Called for every inbound agent->client request (a message with both an
   * id and a method). The returned value (awaited) becomes the JSON-RPC
   * `result`. If it throws, a JSON-RPC error response is sent instead.
   */
  onRequest?: (method: string, params: unknown) => Promise<unknown> | unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class AcpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = "";

  constructor(private readonly opts: AcpClientOptions) {}

  /** Send a JSON-RPC request and resolve with its `result` (or reject on `error`). */
  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.opts.write(payload);
    });
  }

  /** Push inbound bytes from the agent's stdout. Parses on newline boundaries. */
  feed(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        // Ignore non-JSON noise (e.g. stray log lines on stdout).
        continue;
      }
      this.handle(message);
    }
  }

  /** Reject all in-flight requests — call when the agent process exits early. */
  rejectAll(reason: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private handle(message: JsonRpcMessage): void {
    const hasId = typeof message.id === "number";
    const hasMethod = typeof message.method === "string";

    if (hasId && !hasMethod) {
      // Response to one of our requests.
      const pending = this.pending.get(message.id!);
      if (!pending) return;
      this.pending.delete(message.id!);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "ACP request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (hasId && hasMethod) {
      // Request from the agent that we must answer.
      void this.respondToRequest(message.id!, message.method!, message.params);
      return;
    }

    if (hasMethod) {
      // Notification.
      this.opts.onNotification(message.method!, message.params);
    }
  }

  private async respondToRequest(
    id: number,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = this.opts.onRequest
        ? await this.opts.onRequest(method, params)
        : null;
      this.opts.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
    } catch (error) {
      this.opts.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        }) + "\n",
      );
    }
  }
}

import WebSocket from "ws";

export interface T3Config {
  serverUrl: string;
  authToken: string;
  modelInstanceId?: string;
  model?: string;
}

export interface T3Projection {
  thread: { id: string; projectId: string; worktreePath: string | null };
  runs: { id: string; ordinal: number; status: string }[];
  turnItems: { id: string; type: string; text?: string; title?: string | null; status: string; requestId?: string; failure?: { message: string }; output?: string; prompt?: string; questions?: { id: string; question: string }[] }[];
  runtimeRequests: { id: string; kind: string; status: string }[];
}

/** T3 protocol 2 uses a short-lived WebSocket ticket, never a token in the URL. */
export class T3UnavailableError extends Error {}

export class T3Client {
  constructor(private readonly config: T3Config) {}

  async http<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.config.serverUrl), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${this.config.authToken}`,
        "x-t3-orchestration-protocol": "2",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new T3UnavailableError("T3 HTTP connection failed"); });
    if (response.status >= 500) throw new T3UnavailableError(`T3 ${path}: HTTP ${response.status}`);
    if (!response.ok) throw new Error(`T3 ${path}: HTTP ${response.status}`);
    return await response.json() as T;
  }

  async rpc<T>(tag: string, payload: unknown): Promise<T> {
    const { ticket } = await this.http<{ ticket: string }>("/api/auth/websocket-ticket", {});
    const url = new URL("/ws", this.config.serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("orchestrationProtocol", "2");
    url.searchParams.set("wsTicket", ticket);
    return new Promise<T>((resolve, reject) => {
      const ws = new WebSocket(url);
      const finish = (error?: Error, value?: T) => {
        clearTimeout(timeout);
        ws.close();
        if (error) reject(error);
        else resolve(value!);
      };
      const timeout = setTimeout(() => finish(new T3UnavailableError(`T3 ${tag}: timed out`)), 30_000);
      ws.on("open", () => ws.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })));
      ws.on("error", () => finish(new T3UnavailableError(`T3 ${tag}: connection failed`)));
      ws.on("close", () => { clearTimeout(timeout); reject(new T3UnavailableError(`T3 ${tag}: connection closed`)); });
      ws.on("message", (data) => {
        try {
          const parsed: unknown = JSON.parse(data.toString());
          for (const frame of (Array.isArray(parsed) ? parsed : [parsed])) {
            if (frame?._tag !== "Exit" || frame.requestId !== "1") continue;
            if (frame.exit?._tag === "Success") finish(undefined, frame.exit.value as T);
            // Errors may include provider configuration: do not copy server payloads to Bob logs.
            else finish(new Error(`T3 ${tag}: request rejected`));
          }
        } catch { finish(new Error(`T3 ${tag}: invalid response`)); }
      });
    });
  }

  async projection(threadId: string): Promise<T3Projection> {
    return this.rpc<T3Projection>("orchestration.getThreadProjection", { threadId });
  }
}

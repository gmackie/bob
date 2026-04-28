/**
 * OpenCode Server Client
 *
 * Client wrapper for interacting with a separate OpenCode server instance.
 * Used by both chat sessions and ElevenLabs voice sessions to communicate with the LLM.
 */

export interface OpenCodeServerConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface OpenCodeSession {
  id: string;
  status: "active" | "closed";
  createdAt: string;
}

export interface OpenCodeMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface OpenCodeResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost?: number;
  };
}

export class OpenCodeClient {
  private config: Required<OpenCodeServerConfig>;

  constructor(config: OpenCodeServerConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey ?? "",
      timeoutMs: config.timeoutMs ?? 30000,
    };
  }

  /**
   * Create a new session on the OpenCode server
   */
  async createSession(
    metadata?: Record<string, unknown>,
  ): Promise<OpenCodeSession> {
    const response = await this.request("/session", {
      method: "POST",
      body: JSON.stringify({
        title:
          typeof metadata?.bobConversationId === "string"
            ? `Bob ${metadata.bobConversationId}`
            : undefined,
      }),
    });

    type CreateSessionResponse = {
      id?: string;
      time?: { created?: number | string };
    };

    const json = (await response.json()) as CreateSessionResponse;
    if (!json.id) {
      throw new Error("OpenCode createSession: missing id in response");
    }

    const created = json.time?.created;

    return {
      id: json.id,
      status: "active",
      createdAt:
        typeof created === "number" || typeof created === "string"
          ? String(created)
          : new Date().toISOString(),
    };
  }

  /**
   * Send a message to an OpenCode session and get a streaming response
   */
  async sendMessage(
    sessionId: string,
    message: OpenCodeMessage,
    _options?: { stream?: boolean },
  ): Promise<AsyncIterable<OpenCodeResponse>> {
    const response = await this.request(`/session/${sessionId}/message`, {
      method: "POST",
      body: JSON.stringify({
        parts: [{ type: "text", text: message.content }],
      }),
    });

    if (!response.body) {
      throw new Error("No response body from OpenCode server");
    }

    return this.parseStreamResponse(response.body);
  }

  /**
   * Get session history
   */
  async getSessionHistory(
    _sessionId: string,
    _limit?: number,
  ): Promise<OpenCodeMessage[]> {
    throw new Error("OpenCode getSessionHistory not implemented");
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request(`/session/${sessionId}`, {
      method: "DELETE",
    });
  }

  /**
   * Make an HTTP request to the OpenCode server
   */
  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      // Use type assertion to work around Node.js vs browser type differences
      const fetchOptions: RequestInit = {
        ...options,
        headers: headers as any,
        signal: controller.signal as any,
      };

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `OpenCode server error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `OpenCode server request timeout after ${this.config.timeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractTextFromOpenCodeJson(data: unknown): string {
    if (!data || typeof data !== "object") return "";

    const record = data as Record<string, unknown>;

    const parts = record.parts;
    if (Array.isArray(parts)) {
      return parts
        .filter(
          (p): p is { type?: unknown; text?: unknown } =>
            Boolean(p) && typeof p === "object",
        )
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
    }

    if (typeof record.content === "string") return record.content;
    if (typeof record.delta === "string") return record.delta;

    return "";
  }

  private async *parseStreamResponse(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<OpenCodeResponse> {
    const text = await new Response(body).text();

    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const data = JSON.parse(trimmed);
      const content = this.extractTextFromOpenCodeJson(data);
      if (content) {
        yield { content };
      }
      return;
    } catch {}

    const lines = trimmed.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;

      const maybeJson = line.startsWith("data: ") ? line.slice(6) : line;

      try {
        const data = JSON.parse(maybeJson);
        const content = this.extractTextFromOpenCodeJson(data);
        if (content) {
          yield { content };
        }
      } catch {
        continue;
      }
    }
  }
}

/**
 * Create an OpenCode client instance from environment/config
 */
export function createOpenCodeClient(): OpenCodeClient {
  const baseUrl = process.env.OPENCODE_SERVER_URL ?? "http://localhost:8080";
  const apiKey = process.env.OPENCODE_API_KEY;

  return new OpenCodeClient({
    baseUrl,
    apiKey,
    timeoutMs: 30000,
  });
}

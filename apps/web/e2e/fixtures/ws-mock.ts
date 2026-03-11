import type { Page } from "@playwright/test";

export interface MockWebSocketMessage {
  type: string;
  payload?: unknown;
}

export interface WebSocketMockOptions {
  urlPattern?: RegExp;
  initialMessages?: MockWebSocketMessage[];
  connectionDelay?: number;
}

export const WsMessageTypes = {
  CONNECTED: "connected",
  AUTHENTICATED: "authenticated",
  ERROR: "error",
  SESSION_UPDATE: "session.update",
  WORKFLOW_STATUS_CHANGE: "workflow.status_change",
  AWAITING_INPUT: "awaiting_input",
  INPUT_RESOLVED: "input_resolved",
  MESSAGE_CHUNK: "message.chunk",
  MESSAGE_COMPLETE: "message.complete",
} as const;

export function createWorkflowStatusMessage(
  sessionId: string,
  status: string,
  statusMessage?: string,
  awaitingInput?: {
    question: string;
    options?: string[] | null;
    defaultAction: string;
    expiresAt: string;
  },
): MockWebSocketMessage {
  return {
    type: WsMessageTypes.WORKFLOW_STATUS_CHANGE,
    payload: {
      sessionId,
      workflowStatus: status,
      statusMessage,
      awaitingInput,
    },
  };
}

export function createAwaitingInputMessage(
  sessionId: string,
  question: string,
  options: string[] | null,
  defaultAction: string,
  expiresAt: string,
): MockWebSocketMessage {
  return {
    type: WsMessageTypes.AWAITING_INPUT,
    payload: {
      sessionId,
      question,
      options,
      defaultAction,
      expiresAt,
    },
  };
}

export function createInputResolvedMessage(
  sessionId: string,
  resolution: { type: "human" | "timeout"; value: string },
): MockWebSocketMessage {
  return {
    type: WsMessageTypes.INPUT_RESOLVED,
    payload: {
      sessionId,
      resolution,
    },
  };
}

export class WebSocketMock {
  private page: Page;
  private messages: MockWebSocketMessage[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  async setup(options: WebSocketMockOptions = {}): Promise<void> {
    const urlPattern =
      options.urlPattern ?? /\/api\/gateway|ws:\/\/.*\/gateway/;

    await this.page.exposeFunction("__wsMockReceive", (message: string) => {
      this.messages.push(JSON.parse(message));
    });

    await this.page.addInitScript(
      ({ urlPatternStr, initialMessages, connectionDelay }) => {
        const urlPattern = new RegExp(urlPatternStr);
        const OriginalWebSocket = window.WebSocket;

        interface MockWSInstance {
          url: string;
          readyState: number;
          onopen: ((ev: Event) => void) | null;
          onmessage: ((ev: MessageEvent) => void) | null;
          onclose: ((ev: CloseEvent) => void) | null;
          onerror: ((ev: Event) => void) | null;
          send: (data: string) => void;
          close: () => void;
        }

        (window as unknown as { __wsMocks: MockWSInstance[] }).__wsMocks = [];

        class MockWebSocket implements MockWSInstance {
          url: string;
          readyState = 0;
          onopen: ((ev: Event) => void) | null = null;
          onmessage: ((ev: MessageEvent) => void) | null = null;
          onclose: ((ev: CloseEvent) => void) | null = null;
          onerror: ((ev: Event) => void) | null = null;

          static CONNECTING = 0;
          static OPEN = 1;
          static CLOSING = 2;
          static CLOSED = 3;

          constructor(url: string) {
            this.url = url;
            (
              window as unknown as { __wsMocks: MockWSInstance[] }
            ).__wsMocks.push(this);

            setTimeout(() => {
              this.readyState = 1;
              if (this.onopen) {
                this.onopen(new Event("open"));
              }

              if (initialMessages && initialMessages.length > 0) {
                initialMessages.forEach(
                  (msg: { type: string; payload?: unknown }, idx: number) => {
                    setTimeout(() => {
                      this.receiveMessage(msg);
                    }, idx * 50);
                  },
                );
              }
            }, connectionDelay ?? 100);
          }

          send(data: string): void {
            (
              window as unknown as { __wsMockReceive: (msg: string) => void }
            ).__wsMockReceive(data);
          }

          close(): void {
            this.readyState = 3;
            if (this.onclose) {
              this.onclose(new CloseEvent("close"));
            }
          }

          receiveMessage(message: { type: string; payload?: unknown }): void {
            if (this.onmessage && this.readyState === 1) {
              this.onmessage(
                new MessageEvent("message", {
                  data: JSON.stringify(message),
                }),
              );
            }
          }
        }

        window.WebSocket = class extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            const urlStr = url.toString();
            if (urlPattern.test(urlStr)) {
              return new MockWebSocket(urlStr) as unknown as WebSocket;
            }
            super(url, protocols);
          }
        } as typeof WebSocket;
      },
      {
        urlPatternStr: urlPattern.source,
        initialMessages: options.initialMessages ?? [],
        connectionDelay: options.connectionDelay ?? 100,
      },
    );
  }

  async sendMessage(message: MockWebSocketMessage): Promise<void> {
    await this.page.evaluate((msg) => {
      const mocks = (
        window as unknown as {
          __wsMocks: Array<{ receiveMessage: (m: unknown) => void }>;
        }
      ).__wsMocks;
      mocks.forEach((mock) => {
        if (mock && typeof mock.receiveMessage === "function") {
          mock.receiveMessage(msg);
        }
      });
    }, message);
  }

  getReceivedMessages(): MockWebSocketMessage[] {
    return this.messages;
  }

  async waitForMessage(
    type: string,
    timeout = 5000,
  ): Promise<MockWebSocketMessage | undefined> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const msg = this.messages.find((m) => m.type === type);
      if (msg) return msg;
      await new Promise((r) => setTimeout(r, 100));
    }
    return undefined;
  }

  clearMessages(): void {
    this.messages = [];
  }
}

export async function setupWebSocketMock(
  page: Page,
  options?: WebSocketMockOptions,
): Promise<WebSocketMock> {
  const mock = new WebSocketMock(page);
  await mock.setup(options);
  return mock;
}

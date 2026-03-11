import type { Page, Route } from "@playwright/test";

export interface TrpcMockHandlers {
  [path: string]: unknown;
}

export async function mockTrpc(
  page: Page,
  handlers: TrpcMockHandlers,
): Promise<void> {
  await page.route("**/api/trpc**", async (route: Route) => {
    const request = route.request();
    let body: unknown;

    try {
      body = await request.postDataJSON();
    } catch {
      body = null;
    }

    interface TrpcCall {
      id: number;
      jsonrpc: string;
      method: string;
      params?: { path?: string; input?: unknown };
    }

    const calls = Array.isArray(body) ? (body as TrpcCall[]) : [];
    const results = calls.map((call) => {
      const path = call?.params?.path;
      if (path && path in handlers) {
        return { id: call.id, result: { data: handlers[path] } };
      }
      return {
        id: call.id,
        error: { code: "NOT_FOUND", message: `No mock for ${path}` },
      };
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(results),
    });
  });
}

export async function mockTrpcQuery(
  page: Page,
  path: string,
  data: unknown,
): Promise<void> {
  await mockTrpc(page, { [path]: data });
}

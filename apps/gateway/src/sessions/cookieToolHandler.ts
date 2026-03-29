/**
 * Cookie tool handler for the gateway.
 *
 * When an agent calls the `get_cookies` tool, the gateway intercepts the
 * tool call, fetches decrypted cookies from the Bob web API (scoped to
 * the session's allowed domains), and returns them to the agent.
 */

const COOKIE_TOOL_NAMES = new Set(["get_cookies"]);

/** Check whether a tool name is a cookie tool that this handler manages. */
export function isCookieToolCall(toolName: string): boolean {
  return COOKIE_TOOL_NAMES.has(toolName);
}

/**
 * Handle a get_cookies tool call from the agent.
 *
 * Calls the Bob web API's tRPC endpoint to fetch decrypted cookies
 * scoped to the session and requested domain.
 */
export async function handleCookieToolCall(
  sessionId: string,
  toolName: string,
  argsJson: string,
): Promise<string> {
  if (toolName !== "get_cookies") {
    return JSON.stringify({ error: `Unknown cookie tool: ${toolName}` });
  }

  let args: { domain?: string };
  try {
    args = JSON.parse(argsJson) as { domain?: string };
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments" });
  }

  if (!args.domain) {
    return JSON.stringify({ error: "domain parameter is required" });
  }

  const bobApiUrl = process.env.BOB_API_URL ?? "http://localhost:3000";
  const bobApiKey = process.env.BOB_API_KEY;

  if (!bobApiKey) {
    return JSON.stringify({ error: "BOB_API_KEY not configured on gateway" });
  }

  try {
    // Call the tRPC endpoint to get scoped, decrypted cookies
    const url = new URL("/api/trpc/cookies.getForSession", bobApiUrl);
    url.searchParams.set(
      "input",
      JSON.stringify({
        sessionId,
        domain: args.domain,
      }),
    );

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${bobApiKey}` },
    });

    if (!response.ok) {
      return JSON.stringify({
        error: `Failed to fetch cookies: ${response.status}`,
      });
    }

    const data = (await response.json()) as {
      result: { data: { cookies: unknown[]; error?: string } };
    };

    const result = data.result.data;

    if (result.error) {
      return JSON.stringify({ error: result.error });
    }

    return JSON.stringify({
      cookies: result.cookies,
      count: result.cookies.length,
      domain: args.domain,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[cookieToolHandler] Error handling ${toolName}:`,
      error,
    );
    return JSON.stringify({ error: `Cookie fetch failed: ${message}` });
  }
}

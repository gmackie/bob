import { WebSocket } from "ws";

export interface ConnectedDesktop {
  kind: "connected";
  appUrl: string;
  apiUrl: string;
  gatewayUrl: string;
  apiKey: string;
  workspaceId: string;
  userId: string;
  devDir: string;
}
export type DesktopMode = ConnectedDesktop | { kind: "local"; roots: string[] };

function secureUrl(value: string, websocket = false): URL {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== (websocket ? "wss:" : "https:") && !(loopback && url.protocol === (websocket ? "ws:" : "http:")))) {
    throw new Error("Desktop endpoints must use HTTPS/WSS (or loopback) without URL credentials or query tokens");
  }
  return url;
}

export function readDesktopMode(env: Record<string, string | undefined>): DesktopMode {
  const fields = ["BOB_DESKTOP_APP_URL", "BOB_DESKTOP_GATEWAY_URL", "BOB_DESKTOP_API_KEY", "BOB_DESKTOP_WORKSPACE_ID", "BOB_DESKTOP_USER_ID", "BOB_DESKTOP_DEV_DIR"] as const;
  if (!fields.some((field) => env[field])) {
    const roots: unknown = JSON.parse(env.BOB_DESKTOP_FILESYSTEM_ROOTS ?? "[]");
    if (!Array.isArray(roots) || roots.some((root) => typeof root !== "string" || !root.trim())) throw new Error("Desktop filesystem roots must be an explicit JSON array of paths");
    return { kind: "local", roots: roots as string[] };
  }
  if (fields.some((field) => !env[field]?.trim())) throw new Error("Connected desktop needs an app origin, gateway URL, API key, workspace, user ID, and development directory; see PACKAGING.md");
  if (/\s/.test(env.BOB_DESKTOP_API_KEY!)) throw new Error("Desktop API key must not contain whitespace");
  const app = secureUrl(env.BOB_DESKTOP_APP_URL!);
  if (app.pathname !== "/") throw new Error("Connected app URL must be an origin, so browser and daemon share one API");
  const gateway = secureUrl(env.BOB_DESKTOP_GATEWAY_URL!, true);
  return { kind: "connected", appUrl: app.origin, apiUrl: `${app.origin}/api`, gatewayUrl: gateway.toString(),
    apiKey: env.BOB_DESKTOP_API_KEY!, workspaceId: env.BOB_DESKTOP_WORKSPACE_ID!, userId: env.BOB_DESKTOP_USER_ID!, devDir: env.BOB_DESKTOP_DEV_DIR! };
}

/** Authenticated probe uses a browser hello, so it cannot supersede an active
 * workspace daemon. The API's owned workspace and gateway principal must agree. */
export async function verifyConnectedDesktop(config: ConnectedDesktop): Promise<void> {
  const response = await fetch(`${config.apiUrl}/trpc/workspace.list`, {
    headers: { authorization: `Bearer ${config.apiKey}` }, redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Connected Bob API rejected the desktop credential");
  const body = await response.json() as { result?: { data?: { json?: Array<{ workspace?: { id?: string; ownerUserId?: string } }> } } };
  const workspace = body.result?.data?.json?.find((row) => row.workspace?.id === config.workspaceId)?.workspace;
  if (!workspace || workspace.ownerUserId !== config.userId) throw new Error("Configured workspace is not owned by the configured user on this Bob API");
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(config.gatewayUrl);
    const timer = setTimeout(() => finish(new Error("Gateway authentication timed out")), 8_000);
    let settled = false;
    function finish(error?: Error) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.terminate();
      if (error) reject(error); else resolve();
    }
    socket.on("open", () => socket.send(JSON.stringify({ type: "hello", clientId: "desktop-preflight", deviceType: "web", token: config.apiKey })));
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(String(data)) as { type?: string; userId?: string };
        if (message.type === "hello_ok") finish(message.userId === config.userId ? undefined : new Error("API and gateway identities do not match"));
        else if (message.type === "error") finish(new Error("Gateway rejected the desktop credential"));
      } catch { finish(new Error("Gateway returned an invalid handshake")); }
    });
    socket.on("error", () => finish(new Error("Configured gateway is unreachable")));
    socket.on("close", () => finish(new Error("Gateway closed before authentication")));
  });
}

/** JSON is valid YAML for the bundled Go CLI. Keep the key in the child
 * environment; this private, per-launch file only selects workspace/directory. */
export function daemonConfig(config: ConnectedDesktop): string {
  return JSON.stringify({ workspace_id: config.workspaceId, dev_dir: config.devDir });
}
export function daemonArgs(config: ConnectedDesktop, configPath: string): string[] {
  return ["start", config.devDir, "--config", configPath];
}
export function daemonEnvironment(config: ConnectedDesktop, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...inherited, BOB_SERVER_URL: config.apiUrl, BOB_GATEWAY_URL: config.gatewayUrl, BOB_AUTH_TOKEN: config.apiKey };
}

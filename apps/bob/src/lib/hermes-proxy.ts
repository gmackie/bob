import {
  HermesInputError,
  validateHermesMessagingPlatformUpdate,
  type HermesOverview,
} from "./hermes-client";

const HERMES_PATH = "/hermes";
const HERMES_NATIVE_API_PATH = "/api/hermes";
const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isAuthorizedHermesOperator(
  userId: string,
  configuredUserIds: string | undefined,
): boolean {
  if (!configuredUserIds) return false;
  return configuredUserIds
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .includes(userId);
}

export function validateHermesBrowserRequest(
  request: Request,
): { status: 403 | 405; error: string } | null {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { status: 405, error: "method_not_allowed" };
  }

  const isWebSocket =
    request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (SAFE_METHODS.has(method) && !isWebSocket) return null;

  const origin = request.headers.get("origin");
  try {
    if (origin && new URL(origin).origin === new URL(request.url).origin) {
      return null;
    }
  } catch {
    // Malformed and opaque origins are denied below.
  }
  return { status: 403, error: "cross_origin_request_denied" };
}

export function isHermesProxyPath(path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? path;
  return pathname === HERMES_PATH || pathname.startsWith(`${HERMES_PATH}/`);
}

export function isHermesNativeApiPath(path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? path;
  return pathname.startsWith(`${HERMES_NATIVE_API_PATH}/`);
}

export function isAllowedHermesProxyServiceRequest(
  method: string | null,
  uri: string | null,
): boolean {
  if (!method || !uri || !ALLOWED_METHODS.has(method.toUpperCase()))
    return false;
  const url = new URL(uri, "https://hermes.invalid");
  return (
    url.origin === "https://hermes.invalid" &&
    (url.pathname === "/hermes" || url.pathname.startsWith("/hermes/"))
  );
}

function safeHermesOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Hermes origin must be an HTTPS origin");
  }
  return url.origin;
}

function upstreamHeaders(
  request: Request,
  proxyToken: string,
  sessionToken?: string,
): Headers {
  const incomingUrl = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("cookie");
  headers.set("authorization", `Bearer ${proxyToken}`);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.slice(0, -1));
  if (sessionToken) headers.set("x-hermes-session-token", sessionToken);
  return headers;
}

function proxyRequest(request: Request, url: URL, headers: Headers): Request {
  return new Request(url, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });
}

export function createHermesProxyRequest(
  request: Request,
  origin: string,
  proxyToken: string,
): Request {
  const incoming = new URL(request.url);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    safeHermesOrigin(origin),
  );
  return proxyRequest(request, target, upstreamHeaders(request, proxyToken));
}

export function createHermesBootstrapRequest(
  request: Request,
  origin: string,
  proxyToken: string,
): Request {
  const headers = upstreamHeaders(request, proxyToken);
  headers.set("accept", "text/html");
  return new Request(new URL("/hermes/", safeHermesOrigin(origin)), {
    method: "GET",
    headers,
    redirect: "manual",
  });
}

export function createHermesNativeApiRequest(
  request: Request,
  origin: string,
  proxyToken: string,
  sessionToken: string,
): Request {
  const incoming = new URL(request.url);
  const suffix = incoming.pathname.slice(HERMES_NATIVE_API_PATH.length);
  const target = new URL(
    `/hermes/api${suffix}${incoming.search}`,
    safeHermesOrigin(origin),
  );
  return proxyRequest(
    request,
    target,
    upstreamHeaders(request, proxyToken, sessionToken),
  );
}

export function extractHermesSessionToken(html: string): string | null {
  return (
    html.match(/__HERMES_SESSION_TOKEN__\s*=\s*(["'])([^"']+)\1/)?.[2] ?? null
  );
}

export function getHermesLoginRedirect(request: Request): string | null {
  if (!request.headers.get("accept")?.includes("text/html")) return null;
  const requestUrl = new URL(request.url);
  const login = new URL("/login", requestUrl.origin);
  login.searchParams.set(
    "callbackUrl",
    `${requestUrl.pathname}${requestUrl.search}`,
  );
  return login.toString();
}

export async function validateHermesNativeApiMutation(
  request: Request,
): Promise<{ field: string; message: string } | null> {
  const match = new URL(request.url).pathname.match(
    /^\/api\/hermes\/messaging\/platforms\/([^/]+)$/,
  );
  if (request.method !== "PUT" || !match?.[1]) return null;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return {
      field: "body",
      message: "Hermes connector update must be valid JSON.",
    };
  }
  try {
    validateHermesMessagingPlatformUpdate(decodeURIComponent(match[1]), body);
    return null;
  } catch (error) {
    if (error instanceof HermesInputError)
      return { field: error.field, message: error.message };
    throw error;
  }
}

function apiRequest(
  origin: string,
  proxyToken: string,
  sessionToken: string,
  path: string,
): Request {
  return new Request(new URL(`/hermes/api${path}`, safeHermesOrigin(origin)), {
    headers: {
      authorization: `Bearer ${proxyToken}`,
      "x-hermes-session-token": sessionToken,
    },
  });
}

async function checkedJson<T>(
  fetcher: typeof fetch,
  request: Request,
): Promise<T> {
  const response = await fetcher(request);
  if (!response.ok)
    throw new Error(`Hermes overview request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function fetchHermesOverview(options: {
  origin: string;
  proxyToken: string;
  sessionToken: string;
  fetcher?: typeof fetch;
}): Promise<HermesOverview> {
  const fetcher = options.fetcher ?? fetch;
  const request = <T>(path: string) =>
    checkedJson<T>(
      fetcher,
      apiRequest(
        options.origin,
        options.proxyToken,
        options.sessionToken,
        path,
      ),
    );
  const [status, platformData, jobs, sessionData, providerData] =
    await Promise.all([
      request<HermesOverview["status"]>("/status"),
      request<{ platforms: HermesOverview["platforms"] }>(
        "/messaging/platforms",
      ),
      request<HermesOverview["jobs"]>("/cron/jobs?profile=all"),
      request<{ sessions: HermesOverview["sessions"]; total: number }>(
        "/sessions?limit=12&offset=0&order=recent",
      ),
      request<{ providers: HermesOverview["providers"] }>("/providers/oauth"),
    ]);
  return {
    status,
    platforms: platformData.platforms,
    jobs,
    sessions: sessionData.sessions,
    sessionTotal: sessionData.total,
    providers: providerData.providers,
  };
}

export function sanitizeHermesResponse(
  upstream: Response,
  publicOrigin: string,
  upstreamOrigin: string,
): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  const location = headers.get("location");
  if (location) {
    try {
      const target = new URL(location, upstreamOrigin);
      if (target.origin === new URL(upstreamOrigin).origin)
        headers.set(
          "location",
          `${new URL(publicOrigin).origin}${target.pathname}${target.search}${target.hash}`,
        );
    } catch {
      headers.delete("location");
    }
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

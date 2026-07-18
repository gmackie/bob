const HERMES_PATH = "/hermes";
const HERMES_NATIVE_API_PATH = "/api/hermes";

export function isHermesProxyPath(path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? path;
  return pathname === HERMES_PATH || pathname.startsWith(`${HERMES_PATH}/`);
}

export function isHermesNativeApiPath(path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? path;
  return pathname.startsWith(`${HERMES_NATIVE_API_PATH}/`);
}

export function extractHermesSessionToken(html: string): string | null {
  const match = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*(["'])([^"']+)\1/);
  return match?.[2] ?? null;
}

export function createHermesNativeApiRequest(
  request: Request,
  origin: string,
  sessionToken: string,
): Request {
  const incomingUrl = new URL(request.url);
  const suffix = incomingUrl.pathname.slice(HERMES_NATIVE_API_PATH.length);
  const upstreamUrl = new URL(
    `/hermes/api${suffix}${incomingUrl.search}`,
    origin,
  );
  const headers = new Headers(request.headers);
  headers.set("x-hermes-session-token", sessionToken);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.slice(0, -1));

  return new Request(upstreamUrl, {
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
): Request {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${incomingUrl.pathname}${incomingUrl.search}`,
    origin,
  );
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.slice(0, -1));

  return new Request(upstreamUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });
}

export function getHermesLoginRedirect(request: Request): string | null {
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (!acceptsHtml) return null;

  const requestUrl = new URL(request.url);
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set(
    "callbackUrl",
    `${requestUrl.pathname}${requestUrl.search}`,
  );
  return loginUrl.toString();
}

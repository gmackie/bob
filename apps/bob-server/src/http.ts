import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export type HttpServerOptions = { authToken: string | undefined; handler: HttpHandler };

function equalToken(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Exchange the one-time navigation credential before proxying any document.
 * Follow-up browser requests use a HttpOnly session cookie; the bootstrap
 * token never reaches upstream URLs, referrers, assets, or application logs. */
export function createHttpServer(opts: HttpServerOptions): Server {
  const cookieName = `bob_local_${randomBytes(8).toString("hex")}`;
  const cookieToken = randomBytes(32).toString("hex");
  let bootstrapConsumed = false;
  const server = createServer(async (req, res) => {
    if (opts.authToken) {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("invalid request URL");
        return;
      }
      const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
      const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const bearerValid = equalToken(bearer, opts.authToken);
      const cookieValid = equalToken(cookie, cookieToken);
      if (req.method === "GET" && url.pathname === "/" && !bootstrapConsumed && equalToken(url.searchParams.get("t") ?? undefined, opts.authToken)) {
        bootstrapConsumed = true;
        url.searchParams.delete("t");
        res.writeHead(303, {
          location: `${url.pathname}${url.search}`,
          "set-cookie": `${cookieName}=${cookieToken}; HttpOnly; SameSite=Strict; Path=/`,
          "referrer-policy": "no-referrer",
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      if (!bearerValid && !cookieValid) {
        res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
        res.end("unauthorized");
        return;
      }
      // Cookie authentication must not permit a web page on a different
      // origin (including a different loopback port) to drive local authority.
      if (!bearerValid && req.headers.origin && req.headers.origin !== url.origin) {
        res.writeHead(403); res.end("origin denied"); return;
      }
      url.searchParams.delete("t");
      req.url = `${url.pathname}${url.search}`;
      if (bearerValid) delete req.headers.authorization;
      req.headers.cookie = req.headers.cookie?.split(";").filter((part) => !part.trim().startsWith(`${cookieName}=`)).join(";");
    }
    try {
      await opts.handler(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("internal server error");
    }
  });
  // Local-only mode has no relay. Never let a daemon hang on an invented
  // /sessions endpoint; connected desktop mode uses its configured gateway.
  server.on("upgrade", (_req, socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  return server;
}

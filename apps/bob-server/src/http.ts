import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

export type HttpServerOptions = {
  authToken: string | undefined;
  handler: HttpHandler;
};

/**
 * Create a node:http server that enforces bearer-token auth before
 * dispatching to the wrapped handler. Tokens may be presented as either
 * `Authorization: Bearer <token>` headers or a `?t=<token>` query parameter
 * — the latter is used for the initial browser bootstrap so the opening
 * navigation carries the token through.
 *
 * When authToken is undefined, all requests are passed through. The
 * auth-gated startup path in server.ts always supplies a token.
 */
export function createHttpServer(opts: HttpServerOptions): Server {
  return createServer(async (req, res) => {
    if (opts.authToken) {
      const header = req.headers.authorization;
      const bearer =
        header && header.startsWith("Bearer ")
          ? header.slice("Bearer ".length)
          : undefined;
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "local"}`,
      );
      const query = url.searchParams.get("t") ?? undefined;
      if (bearer !== opts.authToken && query !== opts.authToken) {
        res.statusCode = 401;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("unauthorized");
        return;
      }
    }
    try {
      await opts.handler(req, res);
    } catch (err) {
      console.error("[bob-server] handler error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("internal server error");
      } else {
        res.end();
      }
    }
  });
}

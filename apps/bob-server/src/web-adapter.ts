import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Convert a node:http request into a WHATWG `Request` so it can be handed to
 * the Effect-RPC web handler / REST bridge (which are framework-agnostic
 * `(Request) => Promise<Response>` functions). Buffers the body for non-GET/HEAD.
 */
export async function nodeReqToWebRequest(
  req: IncomingMessage,
  origin: string,
): Promise<Request> {
  const method = req.method ?? "GET";
  const url = `${origin}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  return new Request(url, {
    method,
    headers,
    body: body && body.length > 0 ? body : undefined,
  });
}

/** Stream a WHATWG `Response` back out through a node:http `ServerResponse`. */
export async function writeWebResponseToNode(
  webRes: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

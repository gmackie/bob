import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHttpServer } from "./http.js";

describe("createHttpServer auth-token middleware", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createHttpServer({
      authToken: "secret",
      handler: async (_req, res) => {
        res.statusCode = 200;
        res.end("ok");
      },
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address() as AddressInfo;
    port = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects requests without a token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(401);
  });

  it("accepts requests with Authorization header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts requests with ?t= query parameter (browser bootstrap)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/?t=secret`);
    expect(res.status).toBe(200);
  });
});

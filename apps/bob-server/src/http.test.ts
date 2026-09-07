import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
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

  it("rejects a malformed Host header without crashing the request listener", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/", headers: { host: "[" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.once("error", reject);
      req.setTimeout(1_000, () => req.destroy(new Error("Malformed request hung")));
      req.end();
    });
    expect(status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(401);
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

  it("exchanges bootstrap token for a cookie and keeps assets and RPC authenticated", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/?t=secret`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    for (const route of ["/", "/assets/app.js", "/api/rpc"]) {
      expect((await fetch(`http://127.0.0.1:${port}${route}`, { headers: { cookie: cookie.split(";")[0]! } })).status).toBe(200);
    }
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
      method: "POST", headers: { cookie: cookie.split(";")[0]!, origin: "https://other.example" },
    });
    expect(crossOrigin.status).toBe(403);
  });
});

import http from "http";
import os from "os";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFilesystemRoutes } from "../src/routes/filesystem.js";

async function startServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use("/api/filesystem", createFilesystemRoutes());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to get server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/filesystem`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("filesystem routes", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = await startServer();
    baseUrl = server.baseUrl;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  it("returns home directory", async () => {
    const res = await fetch(`${baseUrl}/home`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ path: os.homedir() });
  });

  it("browses a directory", async () => {
    const home = os.homedir();
    const res = await fetch(
      `${baseUrl}/browse?path=${encodeURIComponent(home)}`,
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.currentPath).toBe(home);
    expect(Array.isArray(body.items)).toBe(true);
  });
});

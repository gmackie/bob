import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { startServer } from "./server.js";

// Heavyweight — spawns blder. Run manually:
//   pnpm --filter @bob/server test:integration
describe.skip("bob-server integration (manual only)", () => {
  it("boots blder + proxies auth-gated traffic", async () => {
    const baseDir = path.join(
      os.tmpdir(),
      `bob-integration-${Date.now().toString(36)}`,
    );
    const { url, stop } = await startServer({
      port: 0,
      host: "127.0.0.1",
      authToken: "t",
      bootstrapFd: undefined,
      noBrowser: true,
      baseDir,
    });
    try {
      const unauthorized = await fetch(`${url}/`);
      expect(unauthorized.status).toBe(401);
      const authorized = await fetch(`${url}/?t=t`);
      expect(authorized.status).toBeLessThan(500);
    } finally {
      await stop();
    }
  }, 60_000);
});

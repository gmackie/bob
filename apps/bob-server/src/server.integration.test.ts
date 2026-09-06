import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "./server.js";

const originalEnv = { ...process.env };
const roots: string[] = [];
afterEach(async () => { process.env = { ...originalEnv }; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("bob-server loopback integration", () => {
  it("spawns an upstream, exchanges bootstrap auth, and preserves application identity and bounded authority", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "bob-server-integration-")); roots.push(baseDir);
    const appDir = path.join(baseDir, "app");
    await mkdir(path.join(appDir, "dist", "server"), { recursive: true });
    await writeFile(path.join(appDir, "package.json"), '{"type":"module"}');
    await writeFile(path.join(appDir, "dist", "server", "index.js"), `
      import {createServer} from 'node:http';
      createServer((req,res)=>{
        if(req.url === '/assets/app.js'){ res.end('window.appLoaded=true');return; }
        if(req.url === '/api/who'){
          if(!req.headers.cookie?.includes('app_session=alice')){res.writeHead(401);res.end('login required');return;}
          res.setHeader('content-type','application/json');res.end(JSON.stringify({userId:'alice',
            operator:req.headers['x-bob-local-operator'] === process.env.BOB_LOCAL_OPERATOR_PROXY_SECRET,
            roots:JSON.parse(process.env.BOB_LOCAL_OPERATOR_ROOTS),
            leakedToken:req.url.includes('bootstrap-token') || (req.headers.cookie||'').includes('bob_local_') || !!req.headers.authorization }));return;
        }
        res.end('<html><script src="/assets/app.js"></script></html>');
      }).listen(Number(process.env.PORT),'127.0.0.1');
    `);
    process.env.BOB_VINEXT_CLI = path.join(appDir, "dist", "server", "index.js");
    process.env.BOB_BLDER_DIR = appDir; delete process.env.BOB_DESKTOP_DEV;
    const { url, stop } = await startServer({ port: 0, host: "127.0.0.1", authToken: "bootstrap-token", bootstrapFd: undefined, noBrowser: true, baseDir, filesystemRoots: [baseDir] });
    try {
      expect((await fetch(url)).status).toBe(401);
      const bootstrap = await fetch(`${url}/?t=bootstrap-token`, { redirect: "manual" });
      expect(bootstrap.status).toBe(303);
      const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0]!;
      expect(await (await fetch(`${url}/assets/app.js`, { headers: { cookie } })).text()).toBe("window.appLoaded=true");
      expect((await fetch(`${url}/api/who`, { headers: { cookie } })).status).toBe(401);
      const identity = await (await fetch(`${url}/api/who`, { headers: { cookie: `${cookie}; app_session=alice`, "x-bob-local-operator": "forged" } })).json();
      expect(identity).toMatchObject({ userId: "alice", operator: true, leakedToken: false });
      expect(identity.roots).toHaveLength(1);
    } finally { await stop(); }
  }, 15_000);
});

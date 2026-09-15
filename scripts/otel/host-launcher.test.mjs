import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "apps/bob-ws-gateway/package.json"));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsup")] }));

test("packaged host preserves response, remote parent and flushes on SIGTERM", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-otel-launcher-"));
  const payloads = [];
  const collector = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    payloads.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  let child;
  let output = "";
  try {
    const moduleDir = join(dir, "runtime/node_modules/vinext/dist/server");
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(moduleDir, "package.json"), '{"type":"module"}');
    await writeFile(join(moduleDir, "prod-server.js"), `import {createServer} from 'node:http';
      export async function startProdServer({port,host}) {
        const server=createServer((req,res)=>res.end('original response'));
        await new Promise(done=>server.listen(port,host,done)); return {server,port};
      }`);
    await copyFile(join(root, "scripts/otel/start-host.mjs"), join(dir, "start-host.mjs"));
    await esbuild.build({ entryPoints: [join(root, "packages/core/src/telemetry/node.ts")], bundle: true, platform: "node", format: "cjs", outfile: join(dir, "telemetry-node.cjs") });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OTEL_") && key !== "SIGNOZ_ENDPOINT"));
    child = spawn(process.execPath, [join(dir, "start-host.mjs"), join(dir, "runtime"), String(port), "127.0.0.1"], {
      env: { ...env, BOB_HOST_APP_CWD: dir, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.address().port}`, OTEL_SERVICE_NAME: "bob-host-smoke" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    let response;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, output);
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/health?token=private-canary`, { headers: { traceparent: "00-11223344556677889900112233445566-1122334455667788-01" } });
        break;
      } catch { await new Promise(done => setTimeout(done, 25)); }
    }
    assert.equal(await response?.text(), "original response", output);
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    assert.equal((await exited)[0], 0, output);
    assert.ok(payloads.length, output);
    assert.ok(!JSON.stringify(payloads).includes("private-canary"));
    const spans = payloads.flatMap(p => p.resourceSpans.flatMap(r => r.scopeSpans.flatMap(s => s.spans)));
    assert.ok(spans.some(s => s.traceId === "11223344556677889900112233445566" && s.parentSpanId === "1122334455667788"));
  } finally {
    if (child && child.exitCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
    collector.closeAllConnections();
    await new Promise(done => collector.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});

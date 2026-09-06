import { serverStartupTimeout } from "./startup-timeout.js";
import { localAuthEnvironment } from "./local-auth.js";
import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { terminateProcessTree } from "./process-tree.js";
import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBlderLaunchSpec, resolveBlderDir } from "./blder-spawn.js";
import { createHttpServer } from "./http.js";
import type { CliArgs } from "./cli.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// apps/bob-server/dist/server.js → ../../../packages/bob/src/db/drizzle
const DB_MIGRATIONS_DIR = path.resolve(
  __dirname,
  "../../../packages/bob/src/db/drizzle",
);

export type StartServerArgs = CliArgs & { authToken: string };

export type StartServerResult = {
  url: string;
  upstreamProcessGroupId: number;
  stop: () => Promise<void>;
};

/**
 * Start bob-server: spawn blder as a child process on a random internal
 * port, then bind an auth-gated reverse proxy on the external port.
 */
export async function startServer(
  args: StartServerArgs,
): Promise<StartServerResult> {
  const startupTimeoutMs = serverStartupTimeout();
  const roots = await Promise.all((args.filesystemRoots ?? []).map((root) => realpath(root)));
  const proxySecret = randomBytes(32).toString("hex");
  const internalPort = await findFreePort();
  const externalPort = args.port || await findFreePort();
  const localAuth = await localAuthEnvironment(args.baseDir, `http://${args.host}:${externalPort}`);
  const pgliteDir = path.join(args.baseDir, "userdata", "db");

  const useDev = process.env.BOB_DESKTOP_DEV === "1";
  const blderDir = resolveBlderDir();
  const launch = buildBlderLaunchSpec({
    blderDir,
    port: internalPort,
    useDev,
  });

  const child: ChildProcess = spawn(launch.executable, [...launch.args], {
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...localAuth,
      PORT: String(internalPort),
      HOST: "127.0.0.1",
      BOB_DB_DRIVER: "pglite",
      BOB_DB_PGLITE_DIR: pgliteDir,
      BOB_DB_MIGRATIONS_DIR: process.env.BOB_DB_MIGRATIONS_DIR ?? DB_MIGRATIONS_DIR,
      BOB_BUILD_TARGET: "node",
      BOB_LOCAL_OPERATOR_PROXY_SECRET: proxySecret,
      BOB_LOCAL_OPERATOR_ROOTS: JSON.stringify(roots),
    },
    stdio: ["ignore", "inherit", "inherit"],
    // Put the child in its own process group so we can signal the whole
    // tree on stop. Without this, the parent exits but grandchildren survive.
    detached: process.platform !== "win32",
  });

  let launchError: Error | undefined;
  child.on("error", (error) => { launchError = error; });
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[bob-server] blder child exited with code ${code}`);
    } else if (signal) {
      console.error(`[bob-server] blder child exited via signal ${signal}`);
    }
  });

  try {
    await waitForPort("127.0.0.1", internalPort, startupTimeoutMs, () => launchError ?? (child.exitCode !== null || child.signalCode !== null ? new Error("blder exited before readiness") : undefined));
  } catch (err) {
    try { await terminateProcessTree(child); } catch (cleanupError) {
      throw new AggregateError([err, cleanupError], "Upstream startup and cleanup failed");
    }
    throw err;
  }

  const server = createHttpServer({
    authToken: args.authToken,
    handler: async (req, res) => {
      // Incoming callers cannot mint the capability header. Only requests
      // which passed the local token/cookie gate receive our launch secret.
      delete req.headers["x-bob-local-operator"];
      req.headers["x-bob-local-operator"] = proxySecret;
      await proxyToInternal(req, res, internalPort);
    },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(externalPort, args.host);
    });
  } catch (error) {
    await terminateProcessTree(child);
    throw error;
  }

  const address = server.address() as AddressInfo;
  const url = `http://${args.host}:${address.port}`;

  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => stopped ??= (async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await terminateProcessTree(child);
  })();

  return { url, stop, upstreamProcessGroupId: child.pid! };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.unref();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        s.close(() => resolve(port));
      } else {
        s.close(() => reject(new Error("failed to allocate port")));
      }
    });
  });
}

async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
  failure: () => Error | undefined,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const failed = failure();
    if (failed) throw failed;
    try {
      const res = await fetch(`http://${host}:${port}/`, { method: "HEAD" });
      if (res.status < 500) return;
      lastErr = new Error(`HEAD / returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `blder did not come up on ${host}:${port} within ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

function proxyToInternal(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
): Promise<void> {
  return new Promise((resolve) => {
    const headers: IncomingHttpHeaders = { ...req.headers };
    // Preserve original host header for blder's URL construction, but patch
    // the connection to avoid keep-alive loops via the upstream socket.
    delete headers["connection"];
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
        upstreamRes.pipe(res);
        upstreamRes.on("end", resolve);
        upstreamRes.on("error", () => resolve());
      },
    );
    upstream.on("error", (err) => {
      console.error("[bob-server] proxy error:", err);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("bad gateway");
      } else {
        res.end();
      }
      resolve();
    });
    req.pipe(upstream);
  });
}

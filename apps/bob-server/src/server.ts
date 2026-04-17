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
import { createHttpServer } from "./http.js";
import type { CliArgs } from "./cli.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/bob-server/dist/server.js → ../../blder → apps/blder
const BLDER_DIR = path.resolve(__dirname, "../../blder");
// apps/bob-server/dist/server.js → ../../../packages/db/drizzle
const DB_MIGRATIONS_DIR = path.resolve(
  __dirname,
  "../../../packages/db/drizzle",
);

export type StartServerArgs = CliArgs & { authToken: string };

export type StartServerResult = {
  url: string;
  stop: () => Promise<void>;
};

/**
 * Start bob-server: spawn blder as a child process on a random internal
 * port, then bind an auth-gated reverse proxy on the external port.
 */
export async function startServer(
  args: StartServerArgs,
): Promise<StartServerResult> {
  const internalPort = await findFreePort();
  const pgliteDir = path.join(args.baseDir, "userdata", "db");

  const useDev = process.env.BOB_DESKTOP_DEV === "1";
  // Task 13 switches to "dev" when BOB_DESKTOP_DEV=1; for Task 6 we stay on
  // the prod "start" path so blder's built dist/server/entry.js is used.
  const blderScript = useDev ? "dev" : "start";

  const child: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@bob/blder", blderScript],
    {
      cwd: BLDER_DIR,
      env: {
        ...process.env,
        PORT: String(internalPort),
        HOST: "127.0.0.1",
        BOB_DB_DRIVER: "pglite",
        BOB_DB_PGLITE_DIR: pgliteDir,
        BOB_DB_MIGRATIONS_DIR: DB_MIGRATIONS_DIR,
        BOB_BUILD_TARGET: "node",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[bob-server] blder child exited with code ${code}`);
    } else if (signal) {
      console.error(`[bob-server] blder child exited via signal ${signal}`);
    }
  });

  try {
    await waitForPort("127.0.0.1", internalPort, 30_000);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }

  const server = createHttpServer({
    authToken: args.authToken,
    handler: async (req, res) => {
      await proxyToInternal(req, res, internalPort);
    },
  });

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
    server.listen(args.port, args.host);
  });

  const address = server.address() as AddressInfo;
  const url = `http://${args.host}:${address.port}`;

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      // Hard-kill if still alive after 3s.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!child.killed && child.exitCode === null) {
            child.kill("SIGKILL");
          }
          resolve();
        }, 3_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };

  return { url, stop };
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
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
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

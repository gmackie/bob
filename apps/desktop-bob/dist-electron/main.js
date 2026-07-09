//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
			key = keys[i];
			if (!__hasOwnProp.call(to, key) && key !== except) {
				__defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
		}
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let electron = require("electron");
let node_child_process = require("node:child_process");
let node_crypto = require("node:crypto");
node_crypto = __toESM(node_crypto);
let node_os = require("node:os");
node_os = __toESM(node_os);
let node_path = require("node:path");
node_path = __toESM(node_path);
let node_readline = require("node:readline");
node_readline = __toESM(node_readline);
let node_fs = require("node:fs");
node_fs = __toESM(node_fs);

//#region src/packaging.ts
function resolveDesktopPaths(options) {
	if (options.isPackaged) {
		const resources = options.resourcesPath;
		return {
			appRoot: resources,
			bobServerBin: node_path.default.join(resources, "bob-server", "dist", "bin.js"),
			daemonBinDir: node_path.default.join(resources, "bin"),
			serverCwd: node_path.default.join(resources, "bob-server")
		};
	}
	const appRoot = node_path.default.resolve(options.electronDir, "../../..");
	return {
		appRoot,
		bobServerBin: node_path.default.join(appRoot, "apps", "bob-server", "dist", "bin.js"),
		daemonBinDir: node_path.default.resolve(options.electronDir, "..", "resources", "bin"),
		serverCwd: appRoot
	};
}
function daemonBinaryBasename(platform, arch) {
	const normalizedArch = arch === "x64" ? "amd64" : arch;
	if (platform === "darwin") return `bob-darwin-${normalizedArch}`;
	if (platform === "linux") return `bob-linux-${normalizedArch}`;
	if (platform === "win32") return `bob-windows-${normalizedArch}.exe`;
	return null;
}
function resolveDaemonBinaryPath(options) {
	const basename = daemonBinaryBasename(options.platform, options.arch);
	if (!basename) return {
		kind: "unsupported-platform",
		platform: options.platform
	};
	const binPath = node_path.default.join(options.binDir, basename);
	if (!node_fs.default.existsSync(binPath)) return {
		kind: "missing",
		expectedPath: binPath
	};
	return {
		kind: "found",
		path: binPath
	};
}

//#endregion
//#region src/rotatingFileSink.ts
/**
* Simple synchronous rotating log file writer. Modeled on t3code's
* RotatingFileSink but kept in-tree since we do not have a shared @bob/shared
* package yet. Rotates when writes exceed maxBytes, keeps at most maxFiles
* backups with a .1, .2, ..., .maxFiles suffix.
*/
var RotatingFileSink = class {
	filePath;
	maxBytes;
	maxFiles;
	throwOnError;
	currentSize = 0;
	closed = false;
	constructor(options) {
		if (options.maxBytes < 1) throw new Error(`maxBytes must be >= 1 (received ${options.maxBytes})`);
		if (options.maxFiles < 1) throw new Error(`maxFiles must be >= 1 (received ${options.maxFiles})`);
		this.filePath = options.filePath;
		this.maxBytes = options.maxBytes;
		this.maxFiles = options.maxFiles;
		this.throwOnError = options.throwOnError ?? false;
		node_fs.default.mkdirSync(node_path.default.dirname(this.filePath), { recursive: true });
		this.pruneOverflowBackups();
		this.currentSize = this.readCurrentSize();
	}
	writeLine(line) {
		const terminated = line.endsWith("\n") ? line : `${line}\n`;
		this.write(terminated);
	}
	write(chunk) {
		if (this.closed) return;
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		if (buffer.length === 0) return;
		try {
			if (this.currentSize > 0 && this.currentSize + buffer.length > this.maxBytes) this.rotate();
			node_fs.default.appendFileSync(this.filePath, buffer);
			this.currentSize += buffer.length;
			if (this.currentSize > this.maxBytes) this.rotate();
		} catch {
			this.currentSize = this.readCurrentSize();
			if (this.throwOnError) throw new Error(`Failed to write log chunk to ${this.filePath}`);
		}
	}
	close() {
		this.closed = true;
	}
	rotate() {
		try {
			const oldest = this.withSuffix(this.maxFiles);
			if (node_fs.default.existsSync(oldest)) node_fs.default.rmSync(oldest, { force: true });
			for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
				const source = this.withSuffix(index);
				const target = this.withSuffix(index + 1);
				if (node_fs.default.existsSync(source)) node_fs.default.renameSync(source, target);
			}
			if (node_fs.default.existsSync(this.filePath)) node_fs.default.renameSync(this.filePath, this.withSuffix(1));
			this.currentSize = 0;
		} catch {
			this.currentSize = this.readCurrentSize();
			if (this.throwOnError) throw new Error(`Failed to rotate log file ${this.filePath}`);
		}
	}
	pruneOverflowBackups() {
		try {
			const dir = node_path.default.dirname(this.filePath);
			const baseName = node_path.default.basename(this.filePath);
			for (const entry of node_fs.default.readdirSync(dir)) {
				if (!entry.startsWith(`${baseName}.`)) continue;
				const suffix = Number(entry.slice(baseName.length + 1));
				if (!Number.isInteger(suffix) || suffix <= this.maxFiles) continue;
				node_fs.default.rmSync(node_path.default.join(dir, entry), { force: true });
			}
		} catch {
			if (this.throwOnError) throw new Error(`Failed to prune log backups for ${this.filePath}`);
		}
	}
	readCurrentSize() {
		try {
			return node_fs.default.statSync(this.filePath).size;
		} catch {
			return 0;
		}
	}
	withSuffix(index) {
		return `${this.filePath}.${index}`;
	}
};

//#endregion
//#region src/main.ts
const { appRoot: APP_ROOT, bobServerBin: BOB_SERVER_BIN, daemonBinDir: DAEMON_BIN_DIR, serverCwd: SERVER_CWD } = resolveDesktopPaths({
	isPackaged: electron.app.isPackaged,
	resourcesPath: process.resourcesPath,
	electronDir: __dirname
});
const USERDATA_DIR = node_path.default.join(node_os.default.homedir(), ".bob", "userdata");
const LOG_DIR = node_path.default.join(USERDATA_DIR, "logs");
const LOG_PATH = node_path.default.join(LOG_DIR, "main.log");
const logSink = new RotatingFileSink({
	filePath: LOG_PATH,
	maxBytes: 10 * 1024 * 1024,
	maxFiles: 10
});
function logLine(source, line) {
	const stamp = (/* @__PURE__ */ new Date()).toISOString();
	logSink.writeLine(`${stamp} [${source}] ${line}`);
}
function pipeChildLogs(source, child) {
	if (child.stdout) node_readline.default.createInterface({ input: child.stdout }).on("line", (line) => {
		logLine(source, line);
		process.stdout.write(`[${source}] ${line}\n`);
	});
	if (child.stderr) node_readline.default.createInterface({ input: child.stderr }).on("line", (line) => {
		logLine(`${source}.err`, line);
		process.stderr.write(`[${source}] ${line}\n`);
	});
}
let serverChild = null;
let daemonChild = null;
let win = null;
async function spawnBobServer() {
	const token = node_crypto.default.randomBytes(32).toString("hex");
	const child = (0, node_child_process.spawn)(process.execPath, [
		BOB_SERVER_BIN,
		"--port",
		"0",
		"--host",
		"127.0.0.1",
		"--auth-token",
		token,
		"--no-browser"
	], {
		cwd: SERVER_CWD,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			BOB_BLDER_DIR: electron.app.isPackaged ? node_path.default.join(process.resourcesPath, "blder") : node_path.default.join(APP_ROOT, "apps", "bob"),
			BOB_DB_MIGRATIONS_DIR: electron.app.isPackaged ? node_path.default.join(process.resourcesPath, "db-migrations") : node_path.default.join(APP_ROOT, "packages", "bob", "src", "db", "drizzle")
		}
	});
	serverChild = child;
	logLine("bob-server", `spawned pid=${child.pid ?? "?"}`);
	if (!child.stdout) throw new Error("bob-server child has no stdout");
	const stdoutRl = node_readline.default.createInterface({ input: child.stdout });
	if (child.stderr) node_readline.default.createInterface({ input: child.stderr }).on("line", (line) => {
		logLine("bob-server.err", line);
		process.stderr.write(`[bob-server] ${line}\n`);
	});
	const readyPromise = new Promise((resolve, reject) => {
		const cleanup = () => {
			stdoutRl.off("line", onReadyLine);
			child.off("exit", onExit);
		};
		const onReadyLine = (line) => {
			try {
				const parsed = JSON.parse(line);
				if (parsed.ready === true && typeof parsed.url === "string") {
					cleanup();
					resolve({
						url: parsed.url,
						token
					});
				}
			} catch {}
		};
		const onExit = (code, signal) => {
			cleanup();
			reject(/* @__PURE__ */ new Error(`bob-server exited before ready (code=${code}, signal=${signal})`));
		};
		stdoutRl.on("line", onReadyLine);
		child.once("exit", onExit);
	});
	stdoutRl.on("line", (line) => {
		logLine("bob-server", line);
		process.stdout.write(`[bob-server] ${line}\n`);
	});
	return await readyPromise;
}
function spawnDaemon(serverUrl, token) {
	const resolution = resolveDaemonBinaryPath({
		platform: process.platform,
		arch: node_os.default.arch(),
		binDir: DAEMON_BIN_DIR
	});
	if (resolution.kind === "unsupported-platform") {
		console.warn(`[desktop] bob daemon is not supported on ${resolution.platform} — skipping daemon spawn`);
		return;
	}
	if (resolution.kind === "missing") {
		console.warn(`[desktop] bob daemon binary not found at ${resolution.expectedPath} — skipping daemon spawn`);
		return;
	}
	const binPath = resolution.path;
	const wsUrl = serverUrl.replace(/^http(s?):\/\//, "ws$1://") + "/sessions";
	const child = (0, node_child_process.spawn)(binPath, ["daemon", "start"], {
		cwd: APP_ROOT,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: {
			...process.env,
			BOB_SERVER_URL: serverUrl,
			BOB_AUTH_TOKEN: token,
			BOB_GATEWAY_URL: wsUrl
		}
	});
	daemonChild = child;
	logLine("bob-daemon", `spawned pid=${child.pid ?? "?"} bin=${binPath}`);
	pipeChildLogs("bob-daemon", child);
	child.on("exit", (code, signal) => {
		logLine("bob-daemon", `exited code=${code ?? "null"} signal=${signal ?? "null"}`);
	});
}
electron.app.whenReady().then(async () => {
	logLine("desktop", `electron ready — mode=${process.env.BOB_DESKTOP_DEV === "1" ? "dev (blder HMR via vinext)" : "start (prebuilt blder)"} logs=${LOG_PATH}`);
	const { url, token } = await spawnBobServer();
	spawnDaemon(url, token);
	win = new electron.BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			preload: node_path.default.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	await win.loadURL(`${url}/?t=${token}`);
});
const SHUTDOWN_GRACE_MS = 3e3;
async function killChildGracefully(label, child) {
	if (!child || child.exitCode !== null || child.killed) return;
	logLine("desktop", `SIGTERM ${label} pid=${child.pid ?? "?"}`);
	child.kill("SIGTERM");
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			if (child.exitCode === null && !child.killed) {
				logLine("desktop", `SIGKILL ${label} pid=${child.pid ?? "?"} (grace elapsed)`);
				try {
					child.kill("SIGKILL");
				} catch {}
			}
			resolve();
		}, SHUTDOWN_GRACE_MS);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}
let shuttingDown = false;
async function shutdownChildren() {
	if (shuttingDown) return;
	shuttingDown = true;
	try {
		await Promise.all([killChildGracefully("bob-server", serverChild), killChildGracefully("bob-daemon", daemonChild)]);
	} finally {
		logSink.close();
	}
}
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", (event) => {
	if (shuttingDown) return;
	event.preventDefault();
	shutdownChildren().finally(() => {
		electron.app.quit();
	});
});
process.once("SIGINT", () => {
	shutdownChildren().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
	shutdownChildren().finally(() => process.exit(143));
});
process.on("exit", () => {
	for (const [label, child] of [["bob-server", serverChild], ["bob-daemon", daemonChild]]) if (child && child.exitCode === null && !child.killed) {
		try {
			child.kill("SIGKILL");
		} catch {}
		try {
			logSink.writeLine(`${(/* @__PURE__ */ new Date()).toISOString()} [desktop] exit handler SIGKILL ${label} pid=${child.pid ?? "?"}`);
		} catch {}
	}
});

//#endregion
//# sourceMappingURL=main.js.map
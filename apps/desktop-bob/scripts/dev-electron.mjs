import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// Wait for tsdown's first build to produce main.js before launching electron,
// otherwise electron opens, errors, and exits before the bundle lands.
const mainPath = path.join(desktopDir, "dist-electron", "main.js");
const deadline = Date.now() + 60_000;
while (!fs.existsSync(mainPath)) {
  if (Date.now() > deadline) {
    console.error(`[dev-electron] timed out waiting for ${mainPath}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 200));
}

// require("electron") returns the absolute path to the electron binary.
const electronBinary = require("electron");
const childEnv = { ...process.env, BOB_DESKTOP_DEV: "1" };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [mainPath], {
  cwd: desktopDir,
  stdio: "inherit",
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

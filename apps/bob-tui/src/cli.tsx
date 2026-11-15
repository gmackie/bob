import { hostname } from "node:os";
import { render } from "ink";

import { configPath, edgeSocketUrl, getKey, removeKey, resolveBaseUrl, saveKey } from "./client/config";
import { LoginError, pollForApiKey, requestDeviceCode, type FetchLike } from "./client/device-login";
import { createSession, type Session, type SessionState } from "./client/session";
import { wsOpener } from "./client/ws-socket";
import { fixtureAttempt, fixtureView, FIXTURE_NOW } from "./fixtures";
import { emptyCommands } from "./model/commands";
import { App, type SessionHandle } from "./ui/App";
import { parseArgs } from "./args";

const USAGE = `bob-tui: the Bob SDLC terminal UI

Usage:
  bob-tui [--url <origin>]          open the live view (default)
  bob-tui login [--url <origin>]    sign in with a device code; stores an API key
  bob-tui logout [--url <origin>]   forget the stored key for that origin
  bob-tui demo                      the UI on a built-in fake view, offline

The origin defaults to https://bob.blder.bot; BOB_URL overrides it, --url overrides both.
Keys are kept in ~/.config/bob/tui.json (mode 0600).`;

async function login(baseUrl: string): Promise<number> {
  const fetchImpl = fetch as unknown as FetchLike;
  const code = await requestDeviceCode(fetchImpl, baseUrl, `Bob TUI (${hostname()})`);
  process.stdout.write(`To sign in, open:\n\n  ${code.verificationUrl}\n\nand confirm the code ${code.userCode}.\nWaiting for approval (Ctrl+C to cancel)…\n`);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const apiKey = await pollForApiKey(fetchImpl, baseUrl, code, { signal: controller.signal });
  const path = configPath();
  await saveKey(path, baseUrl, apiKey);
  process.stdout.write(`Signed in to ${new URL(baseUrl).host}. The key is stored in ${path}.\n`);
  return 0;
}

async function logout(baseUrl: string): Promise<number> {
  const removed = await removeKey(configPath(), baseUrl);
  process.stdout.write(removed
    ? `Forgot the key for ${new URL(baseUrl).host}. Revoke it in Bob's API key settings if it may have leaked.\n`
    : `No key stored for ${new URL(baseUrl).host}.\n`);
  return 0;
}

async function runUi(session: SessionHandle & Partial<Pick<Session, "start" | "stop">>, host: string, now?: () => number): Promise<number> {
  session.start?.();
  const app = render(<App session={session} host={host} {...(now ? { now } : {})} />, { exitOnCtrlC: true });
  await app.waitUntilExit();
  session.stop?.();
  return 0;
}

function demoSession(): SessionHandle {
  // Static fixture: nothing leaves the process; a command only shows a notice.
  let state: SessionState = { view: fixtureView(), commands: emptyCommands(), attempt: fixtureAttempt(), connection: "live", error: null };
  const listeners = new Set<(s: SessionState) => void>();
  return {
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send() { state = { ...state, error: "demo mode: commands are not sent" }; for (const l of listeners) l(state); return "demo"; },
    tick() {},
  };
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "help") { process.stdout.write(`${USAGE}\n`); return 0; }
  if (args.command === "demo") return runUi(demoSession(), "demo", () => FIXTURE_NOW);
  const baseUrl = resolveBaseUrl(args.url);
  if (args.command === "login") return login(baseUrl);
  if (args.command === "logout") return logout(baseUrl);
  const apiKey = await getKey(configPath(), baseUrl);
  if (!apiKey) {
    process.stderr.write(`Not signed in to ${new URL(baseUrl).host}. Run: bob-tui login${args.url ? ` --url ${args.url}` : ""}\n`);
    return 1;
  }
  if (!process.stdin.isTTY) {
    process.stderr.write("bob-tui needs an interactive terminal.\n");
    return 1;
  }
  const session = createSession({ open: wsOpener(edgeSocketUrl(baseUrl), apiKey) });
  return runUi(session, new URL(baseUrl).host);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof LoginError || error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);

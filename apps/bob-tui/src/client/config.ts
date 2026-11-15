// ~/.config/bob/tui.json: the device API key per Bob origin. Directory 0700, file 0600.
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_URL = "https://bob.blder.bot";

export interface Credential { apiKey: string; savedAt: string }
export interface TuiConfig { version: 1; credentials: Record<string, Credential> }

const empty = (): TuiConfig => ({ version: 1, credentials: {} });

/** $XDG_CONFIG_HOME/bob/tui.json, else ~/.config/bob/tui.json. */
export function configPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(base, "bob", "tui.json");
}

/**
 * The Bob origin from --url, then BOB_URL, then the default. Only http(s); the path is
 * dropped so "https://bob.blder.bot/sdlc" and "https://bob.blder.bot" share a key.
 */
export function resolveBaseUrl(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const raw = flag ?? env.BOB_URL ?? DEFAULT_URL;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`Not a URL: ${raw}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Bob URL must be http(s): ${raw}`);
  return url.origin;
}

/** wss://<host>/api/sdlc/ws (ws:// for an http origin, for local development). */
export function edgeSocketUrl(baseUrl: string): string {
  const url = new URL("/api/sdlc/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function loadConfig(path: string): Promise<TuiConfig> {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<TuiConfig>;
    return parsed && typeof parsed.credentials === "object" && parsed.credentials ? { version: 1, credentials: parsed.credentials } : empty();
  } catch {
    throw new Error(`${path} is not valid JSON; fix or delete it, then run bob-tui login.`);
  }
}

/** Writes atomically (temp file + rename), creating the directory 0700 and the file 0600. */
export async function saveConfig(path: string, config: TuiConfig): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function saveKey(path: string, baseUrl: string, apiKey: string, now = new Date()): Promise<void> {
  const config = await loadConfig(path);
  config.credentials[baseUrl] = { apiKey, savedAt: now.toISOString() };
  await saveConfig(path, config);
}

export async function getKey(path: string, baseUrl: string): Promise<string | null> {
  return (await loadConfig(path)).credentials[baseUrl]?.apiKey ?? null;
}

/** Forgets the key for one origin; removes the file when none are left. Returns whether one was stored. */
export async function removeKey(path: string, baseUrl: string): Promise<boolean> {
  const config = await loadConfig(path);
  if (!config.credentials[baseUrl]) return false;
  delete config.credentials[baseUrl];
  if (Object.keys(config.credentials).length === 0) await rm(path, { force: true });
  else await saveConfig(path, config);
  return true;
}

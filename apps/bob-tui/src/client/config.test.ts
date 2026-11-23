import { mkdtemp, readFile, rm, stat, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configPath, DEFAULT_URL, edgeSocketUrl, getKey, loadConfig, removeKey, resolveBaseUrl, saveKey } from "./config";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "bob-tui-config-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const mode = async (p: string) => (await stat(p)).mode & 0o777;
const KEY = `bob_${"b".repeat(64)}`;

describe("config file", () => {
  it("lives under XDG_CONFIG_HOME or ~/.config", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe("/x/bob/tui.json");
    expect(configPath({}, "/home/u")).toBe("/home/u/.config/bob/tui.json");
  });

  it("stores the key with the directory 0700 and the file 0600", async () => {
    const path = join(root, "cfg", "bob", "tui.json");
    await saveKey(path, "https://bob.blder.bot", KEY, new Date(0));
    expect(await mode(join(root, "cfg", "bob"))).toBe(0o700);
    expect(await mode(path)).toBe(0o600);
    expect(await getKey(path, "https://bob.blder.bot")).toBe(KEY);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, credentials: { "https://bob.blder.bot": { apiKey: KEY, savedAt: "1970-01-01T00:00:00.000Z" } } });
  });

  it("tightens an existing, too-open directory and file", async () => {
    const dir = join(root, "bob");
    const path = join(dir, "tui.json");
    await mkdir(dir, { mode: 0o755 });
    await writeFile(path, JSON.stringify({ version: 1, credentials: {} }), { mode: 0o644 });
    await chmod(path, 0o644);
    await saveKey(path, "http://localhost:3000", KEY);
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(path)).toBe(0o600);
  });

  it("keeps keys per origin and removes the file with the last one", async () => {
    const path = join(root, "bob", "tui.json");
    await saveKey(path, "https://a.example", KEY);
    await saveKey(path, "https://b.example", KEY);
    expect(await removeKey(path, "https://a.example")).toBe(true);
    expect(await getKey(path, "https://a.example")).toBeNull();
    expect(await mode(path)).toBe(0o600);
    expect(await removeKey(path, "https://b.example")).toBe(true);
    await expect(stat(path)).rejects.toThrow();
    expect(await removeKey(path, "https://b.example")).toBe(false);
  });

  it("reads a missing file as empty and refuses a corrupt one", async () => {
    expect(await loadConfig(join(root, "none.json"))).toEqual({ version: 1, credentials: {} });
    const bad = join(root, "bad.json");
    await writeFile(bad, "{");
    await expect(loadConfig(bad)).rejects.toThrow(/not valid JSON/);
  });
});

describe("base URL", () => {
  it("prefers --url, then BOB_URL, then the default, keeping only the origin", () => {
    expect(resolveBaseUrl(undefined, {})).toBe(DEFAULT_URL);
    expect(resolveBaseUrl(undefined, { BOB_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
    expect(resolveBaseUrl("https://bob.blder.bot/sdlc", { BOB_URL: "http://x" })).toBe("https://bob.blder.bot");
    expect(() => resolveBaseUrl("ftp://x", {})).toThrow(/http/);
    expect(() => resolveBaseUrl("nope", {})).toThrow(/Not a URL/);
  });

  it("maps to the edge socket URL", () => {
    expect(edgeSocketUrl("https://bob.blder.bot")).toBe("wss://bob.blder.bot/api/sdlc/ws");
    expect(edgeSocketUrl("http://localhost:3000")).toBe("ws://localhost:3000/api/sdlc/ws");
  });
});

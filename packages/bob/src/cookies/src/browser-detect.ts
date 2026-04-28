import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BrowserProfile {
  browser: string;
  profilePath: string;
  profileName: string;
  cookieDbPath: string;
}

interface BrowserDef {
  name: string;
  macPath: string;
  linuxPath: string;
  keychainService: string;
}

const BROWSERS: BrowserDef[] = [
  { name: "chrome", macPath: "Google/Chrome", linuxPath: "google-chrome", keychainService: "Chrome Safe Storage" },
  { name: "chromium", macPath: "Chromium", linuxPath: "chromium", keychainService: "Chromium Safe Storage" },
  { name: "arc", macPath: "Arc/User Data", linuxPath: "arc", keychainService: "Arc Safe Storage" },
  { name: "brave", macPath: "BraveSoftware/Brave-Browser", linuxPath: "BraveSoftware/Brave-Browser", keychainService: "Brave Safe Storage" },
  { name: "edge", macPath: "Microsoft Edge", linuxPath: "microsoft-edge", keychainService: "Microsoft Edge Safe Storage" },
];

export function getKeychainService(browserName: string): string {
  const browser = BROWSERS.find((b) => b.name === browserName);
  return browser?.keychainService ?? "Chrome Safe Storage";
}

export function detectBrowsers(): BrowserProfile[] {
  const home = homedir();
  const isMac = process.platform === "darwin";
  const profiles: BrowserProfile[] = [];

  for (const browser of BROWSERS) {
    const basePath = isMac
      ? join(home, "Library", "Application Support", ...browser.macPath.split("/"))
      : join(home, ".config", ...browser.linuxPath.split("/"));

    if (!existsSync(basePath)) continue;

    // Check for profiles (Default, Profile 1, etc.)
    const entries = readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("Default") && !entry.name.startsWith("Profile")) continue;

      const cookieDb = join(basePath, entry.name, "Cookies");
      if (!existsSync(cookieDb)) continue;

      profiles.push({
        browser: browser.name,
        profilePath: join(basePath, entry.name),
        profileName: entry.name,
        cookieDbPath: cookieDb,
      });
    }
  }

  return profiles;
}

export function findProfile(browserName?: string): BrowserProfile | null {
  const all = detectBrowsers();
  if (browserName) {
    return all.find((p) => p.browser === browserName) ?? null;
  }
  // Default: first available browser
  return all[0] ?? null;
}

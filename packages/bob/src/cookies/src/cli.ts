import { findProfile, detectBrowsers } from "./browser-detect";
import { readCookiesForDomain } from "./chromium-decrypt";
import { createBobRpcClient } from "@gmacko/bob-client";

interface CliArgs {
  command: "import" | "list" | "remove";
  domains: string[];
  browser?: string;
  bobUrl: string;
  bobApiKey: string;
}

function createClient(args: CliArgs) {
  return createBobRpcClient({
    baseURL: `${args.bobUrl}/api/rpc`,
    headers: {
      Authorization: `Bearer ${args.bobApiKey}`,
      "x-rpc-source": "bob-cookies-cli",
    },
  });
}

function parseArgs(args: string[]): CliArgs {
  const command = args[0] as CliArgs["command"];
  const domains: string[] = [];
  let browser: string | undefined;
  let bobUrl = process.env.BOB_URL ?? "http://localhost:3000";
  let bobApiKey = process.env.BOB_API_KEY ?? "";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--domain" && args[i + 1]) {
      domains.push(args[++i]!);
    } else if (args[i] === "--browser" && args[i + 1]) {
      browser = args[++i];
    } else if (args[i] === "--url" && args[i + 1]) {
      bobUrl = args[++i]!;
    } else if (args[i] === "--key" && args[i + 1]) {
      bobApiKey = args[++i]!;
    }
  }

  return { command, domains, browser, bobUrl, bobApiKey };
}

async function importCookies(args: CliArgs) {
  if (args.domains.length === 0) {
    console.error("Error: --domain is required for import");
    process.exit(1);
  }

  const profile = findProfile(args.browser);
  if (!profile) {
    console.error("No browser found. Available browsers:");
    const all = detectBrowsers();
    for (const p of all) console.error(`  ${p.browser} (${p.profileName})`);
    process.exit(1);
  }

  console.log(`Reading cookies from ${profile.browser} (${profile.profileName})...`);

  const allCookies = [];
  for (const domain of args.domains) {
    const cookies = readCookiesForDomain(profile, domain);
    console.log(`  ${domain}: ${cookies.length} cookies`);
    allCookies.push(...cookies);
  }

  if (allCookies.length === 0) {
    console.log("No cookies found.");
    return;
  }

  console.log(`Sending ${allCookies.length} cookies to Bob...`);

  try {
    const result = (await createClient(args).settings.cookies.import({
      cookies: allCookies,
      source: "cli",
    })) as { imported: number; domains: string[] };
    console.log(`Imported ${result.imported} cookies for ${result.domains.join(", ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function listCookies(args: CliArgs) {
  let entries: Array<{
    domain: string;
    count: number;
    source: string | null;
    lastUpdated: string | Date | null;
  }>;
  try {
    entries = (await createClient(args).settings.cookies.list(undefined)) as typeof entries;
  } catch {
    console.error("Failed to list cookies");
    process.exit(1);
  }

  if (entries.length === 0) {
    console.log("Cookie jar is empty.");
    return;
  }

  console.log("Cookie Jar:");
  for (const e of entries) {
    console.log(`  ${e.domain} — ${e.count} cookies (${e.source}, updated ${e.lastUpdated ?? "unknown"})`);
  }
}

async function removeCookies(args: CliArgs) {
  if (args.domains.length === 0) {
    console.error("Error: --domain is required for remove");
    process.exit(1);
  }

  for (const domain of args.domains) {
    try {
      await createClient(args).settings.cookies.remove({ domain });
      console.log(`Removed cookies for ${domain}`);
    } catch {
      console.error(`Failed to remove cookies for ${domain}`);
    }
  }
}

export async function main(argv: string[]) {
  const args = parseArgs(argv);

  if (!args.bobApiKey) {
    console.error("Error: BOB_API_KEY environment variable or --key flag required");
    process.exit(1);
  }

  switch (args.command) {
    case "import":
      return importCookies(args);
    case "list":
      return listCookies(args);
    case "remove":
      return removeCookies(args);
    default:
      console.error("Usage: bob cookies <import|list|remove> [options]");
      console.error("  import --domain <domain> [--browser <name>]");
      console.error("  list");
      console.error("  remove --domain <domain>");
      process.exit(1);
  }
}

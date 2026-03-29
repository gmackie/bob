import { findProfile, detectBrowsers } from "./browser-detect";
import { readCookiesForDomain } from "./chromium-decrypt";

interface CliArgs {
  command: "import" | "list" | "remove";
  domains: string[];
  browser?: string;
  bobUrl: string;
  bobApiKey: string;
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

  const res = await fetch(`${args.bobUrl}/api/cookies/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.bobApiKey}`,
    },
    body: JSON.stringify({ cookies: allCookies, source: "cli" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const result = (await res.json()) as { imported: number; domains: string[] };
  console.log(`Imported ${result.imported} cookies for ${result.domains.join(", ")}`);
}

async function listCookies(args: CliArgs) {
  const res = await fetch(`${args.bobUrl}/api/trpc/cookies.list`, {
    headers: { Authorization: `Bearer ${args.bobApiKey}` },
  });

  if (!res.ok) {
    console.error("Failed to list cookies");
    process.exit(1);
  }

  const data = (await res.json()) as {
    result: { data: Array<{ domain: string; count: number; source: string; lastUpdated: string }> };
  };

  const entries = data.result.data;
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
    const res = await fetch(`${args.bobUrl}/api/trpc/cookies.remove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.bobApiKey}`,
      },
      body: JSON.stringify({ json: { domain } }),
    });

    if (res.ok) {
      console.log(`Removed cookies for ${domain}`);
    } else {
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

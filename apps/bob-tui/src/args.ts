// Command-line parsing for bob-tui, separate from cli.tsx so tests can import it without running main().
export interface ParsedArgs { command: "run" | "login" | "logout" | "demo" | "help"; url?: string }

export function parseArgs(argv: string[]): ParsedArgs {
  let command: ParsedArgs["command"] = "run";
  let url: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h" || arg === "help") return { command: "help" };
    if (arg === "--url") { url = argv[++i]; if (!url) throw new Error("--url needs a value"); continue; }
    if (arg.startsWith("--url=")) { url = arg.slice(6); continue; }
    if (arg === "login" || arg === "logout" || arg === "demo") { command = arg; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, ...(url ? { url } : {}) };
}

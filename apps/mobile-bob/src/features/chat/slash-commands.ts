import { assertDefined } from "~/lib/assert";
import type { ChatMessage } from "./chat-messages";

export interface SlashCommandResult {
  handled: boolean;
  messages?: ChatMessage[];
}

interface CommandHandler {
  name: string;
  description: string;
  execute: (
    args: string,
    context: CommandContext,
  ) => Promise<ChatMessage[]>;
}

export interface CommandContext {
  oodaBaseUrl: string;
  getCookies: () => string | undefined;
  threadId?: string;
}

function systemMessage(content: string): ChatMessage {
  return {
    id: `cmd:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
    mode: "ooda",
    role: "system",
    content,
    timestamp: new Date().toISOString(),
    sourceId: "slash-command",
  };
}

async function trpcQuery(
  baseUrl: string,
  path: string,
  input: unknown,
  cookies?: string,
): Promise<unknown> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/trpc/${path}`);
  url.searchParams.set("input", JSON.stringify({ json: input }));

  const headers: Record<string, string> = {
    "x-trpc-source": "mobile-bob",
  };
  if (cookies) headers.Cookie = cookies;

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { result?: { data?: { json?: unknown } } };
  return body.result?.data?.json;
}

const helpCommand: CommandHandler = {
  name: "help",
  description: "Show available commands",
  execute: () =>
    Promise.resolve([
      systemMessage(
        COMMANDS.map((c) => `/${c.name} — ${c.description}`).join("\n"),
      ),
    ]),
};

const searchCommand: CommandHandler = {
  name: "search",
  description: "Semantic search the knowledge base",
  execute: async (args, ctx) => {
    if (!args.trim()) return [systemMessage("Usage: /search <query>")];

    const result = (await trpcQuery(
      ctx.oodaBaseUrl,
      "oracle.query",
      { task: "mobile knowledge search", question: args.trim(), topK: 5 },
      ctx.getCookies(),
    )) as {
      chunks: {
        sourceTitle: string | null;
        content: string;
        score: number;
        sourceKind: string;
      }[];
      latencyMs: number;
    };

    if (!result.chunks.length) {
      return [systemMessage(`No results for "${args.trim()}"`)];
    }

    const lines = result.chunks.map((c, i) => {
      const title = c.sourceTitle ?? "Untitled";
      const score = Math.round(c.score * 100);
      const preview = c.content.slice(0, 120).replace(/\n/g, " ");
      return `${i + 1}. **${title}** (${score}%, ${c.sourceKind})\n   ${preview}...`;
    });

    return [
      systemMessage(
        `Oracle search: "${args.trim()}" (${result.latencyMs}ms)\n\n${lines.join("\n\n")}`,
      ),
    ];
  },
};

const papersCommand: CommandHandler = {
  name: "papers",
  description: "Search academic papers",
  execute: async (args, ctx) => {
    if (!args.trim()) return [systemMessage("Usage: /papers <query>")];

    const result = (await trpcQuery(
      ctx.oodaBaseUrl,
      "research.papersSearchVault",
      { query: args.trim(), limit: 5 },
      ctx.getCookies(),
    )) as {
      papers: {
        title: string;
        authors: string[];
        year: number | null;
        citationCount: number | null;
      }[];
    };

    if (!result.papers.length) {
      return [systemMessage(`No papers found for "${args.trim()}"`)];
    }

    const lines = result.papers.map((p, i) => {
      const year = p.year ?? "?";
      const cites = p.citationCount ?? 0;
      const authors = p.authors.slice(0, 2).join(", ");
      return `${i + 1}. **${p.title}** (${year}, ${cites} cites)\n   ${authors}`;
    });

    return [systemMessage(`Papers: "${args.trim()}"\n\n${lines.join("\n\n")}`)];
  },
};

const memoryCommand: CommandHandler = {
  name: "memory",
  description: "Search thread memories",
  execute: async (args, ctx) => {
    if (!args.trim()) return [systemMessage("Usage: /memory <query>")];

    const result = (await trpcQuery(
      ctx.oodaBaseUrl,
      "research.threadMemorySearch",
      { query: args.trim(), scope: "all", limit: 5 },
      ctx.getCookies(),
    )) as {
      threads: {
        title: string | null;
        rollingSummaryMd: string;
        topics: string[];
        score: number;
      }[];
    };

    if (!result.threads.length) {
      return [systemMessage(`No memories found for "${args.trim()}"`)];
    }

    const lines = result.threads.map((t, i) => {
      const title = t.title ?? "Untitled thread";
      const score = Math.round(t.score * 100);
      const topics = t.topics.slice(0, 3).join(", ");
      const summary = t.rollingSummaryMd.slice(0, 100).replace(/\n/g, " ");
      return `${i + 1}. **${title}** (${score}%)\n   Topics: ${topics}\n   ${summary}...`;
    });

    return [systemMessage(`Thread memories: "${args.trim()}"\n\n${lines.join("\n\n")}`)];
  },
};

const vaultCommand: CommandHandler = {
  name: "vault",
  description: "List vault notes",
  execute: async (args, ctx) => {
    const kind = args.trim() === "research" ? "research" : "personal";

    const files = (await trpcQuery(
      ctx.oodaBaseUrl,
      "vault.list",
      { vaultKind: kind, glob: "notes/**" },
      ctx.getCookies(),
    )) as string[];

    if (!files.length) {
      return [systemMessage(`No notes in ${kind} vault.`)];
    }

    const grouped = new Map<string, string[]>();
    for (const f of files) {
      const parts = f.split("/");
      // `parts.length >= 3` guarantees index 1 exists, but TS can't narrow
      // array element types from a `.length` check under
      // `noUncheckedIndexedAccess` — assert explicitly instead of `!`.
      const thread = parts.length >= 3 ? assertDefined(parts[1]) : "(root)";
      const list = grouped.get(thread) ?? [];
      list.push(f);
      grouped.set(thread, list);
    }

    const sections = Array.from(grouped.entries()).map(([thread, threadFiles]) => {
      const names = threadFiles.map((f) => `  - ${f.split("/").pop()?.replace(/\.md$/, "")}`);
      return `**${thread}** (${threadFiles.length})\n${names.join("\n")}`;
    });

    return [systemMessage(`${kind} vault (${files.length} notes)\n\n${sections.join("\n\n")}`)];
  },
};

const COMMANDS: CommandHandler[] = [
  helpCommand,
  searchCommand,
  papersCommand,
  memoryCommand,
  vaultCommand,
];

export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const match = /^\/(\w+)\s*(.*)/s.exec(text);
  if (!match) return null;
  // Both groups are unconditional captures in the pattern above, so a
  // successful match always populates match[1] and match[2] — asserted
  // explicitly rather than with `!` because noUncheckedIndexedAccess can't
  // encode "regex capture group always present" as a type-level fact.
  return { name: assertDefined(match[1]), args: assertDefined(match[2]) };
}

export async function executeSlashCommand(
  text: string,
  context: CommandContext,
): Promise<SlashCommandResult> {
  const parsed = parseSlashCommand(text);
  if (!parsed) return { handled: false };

  const command = COMMANDS.find((c) => c.name === parsed.name);
  if (!command) {
    return {
      handled: true,
      messages: [
        systemMessage(`Unknown command: /${parsed.name}\nType /help for available commands.`),
      ],
    };
  }

  try {
    const messages = await command.execute(parsed.args, context);
    return { handled: true, messages };
  } catch (error) {
    return {
      handled: true,
      messages: [
        systemMessage(
          `/${parsed.name} failed: ${error instanceof Error ? error.message : "unknown error"}`,
        ),
      ],
    };
  }
}

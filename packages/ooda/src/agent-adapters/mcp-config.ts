// Translators from the runner's neutral `McpServerConfigLike` (the shape the
// session executor hands each adapter via `registerMcpServers`) into the two
// CLI-adapter-native MCP wire formats:
//
//  - claude-code: a `--mcp-config` JSON document — `{ mcpServers: { <name>:
//    { type, url, headers } } }`. Verified against claude 2.1.215
//    (`claude mcp add --transport http`): `headers` is a key->value OBJECT
//    (the neutral shape carries an array, so we fold it).
//  - codex: repeated `-c mcp_servers.<name>.url="..."` config overrides on
//    `codex exec`. Verified against codex-cli 0.135.0 (`codex mcp add --url`):
//    streamable-HTTP servers live under `mcp_servers.<name>` with a `url` key.
//    The `-c` value is parsed as TOML, so string values must be quoted.

import type { McpServerConfigLike } from "./types";

/** A single claude-code MCP server entry (http transport). */
interface ClaudeMcpServerEntry {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

/** The claude-code `--mcp-config` document. */
interface ClaudeMcpConfigDocument {
  mcpServers: Record<string, ClaudeMcpServerEntry>;
}

/** Fold the neutral `[{ name, value }]` header list into a key->value object. */
function headersToObject(
  headers: ReadonlyArray<{ name: string; value: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name] = h.value;
  return out;
}

/** Build the claude-code `--mcp-config` document from neutral server configs. */
export function buildClaudeMcpConfigDocument(
  servers: readonly McpServerConfigLike[],
): ClaudeMcpConfigDocument {
  const mcpServers: Record<string, ClaudeMcpServerEntry> = {};
  for (const server of servers) {
    const entry: ClaudeMcpServerEntry = { type: "http", url: server.url };
    if (server.headers.length > 0) entry.headers = headersToObject(server.headers);
    mcpServers[server.name] = entry;
  }
  return { mcpServers };
}

/** Serialize the claude-code `--mcp-config` document to a JSON string. */
export function buildClaudeMcpConfigFile(
  servers: readonly McpServerConfigLike[],
): string {
  return JSON.stringify(buildClaudeMcpConfigDocument(servers));
}

/**
 * Build the `codex exec` argv fragment that registers the given MCP servers as
 * streamable-HTTP servers via repeated `-c` config overrides. Each server
 * yields a `-c mcp_servers.<name>.url="<url>"` pair (plus one `-c` per header).
 * Returns an empty array when there are no servers, so callers can spread it
 * unconditionally without changing codex's default behavior.
 */
export function buildCodexMcpConfigArgs(
  servers: readonly McpServerConfigLike[],
): string[] {
  const args: string[] = [];
  for (const server of servers) {
    // Values are parsed as TOML by codex, so strings must be quoted. The URL
    // and header values are runner-generated (loopback URL + our own header
    // names), never user input, so JSON.stringify is a safe TOML-string quote.
    args.push("-c", `mcp_servers.${server.name}.url=${JSON.stringify(server.url)}`);
    for (const header of server.headers) {
      args.push(
        "-c",
        `mcp_servers.${server.name}.http_headers.${header.name}=${JSON.stringify(header.value)}`,
      );
    }
  }
  return args;
}

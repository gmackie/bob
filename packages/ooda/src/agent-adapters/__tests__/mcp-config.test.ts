import { describe, expect, it } from "vitest";

import {
  buildClaudeMcpConfigDocument,
  buildClaudeMcpConfigFile,
  buildCodexMcpConfigArgs,
} from "../mcp-config";
import type { McpServerConfigLike } from "../types";

const server = (
  overrides: Partial<McpServerConfigLike> = {},
): McpServerConfigLike => ({
  type: "http",
  name: "ooda-buddy-tools",
  url: "http://127.0.0.1:5123/mcp/tok-abc",
  headers: [],
  ...overrides,
});

describe("buildClaudeMcpConfigDocument", () => {
  it("maps a server into the claude-code http `mcpServers` shape", () => {
    const doc = buildClaudeMcpConfigDocument([server()]);
    expect(doc).toEqual({
      mcpServers: {
        "ooda-buddy-tools": {
          type: "http",
          url: "http://127.0.0.1:5123/mcp/tok-abc",
        },
      },
    });
  });

  it("folds the neutral header array into a key->value object", () => {
    const doc = buildClaudeMcpConfigDocument([
      server({ headers: [{ name: "X-Token", value: "sekret" }] }),
    ]);
    expect(doc.mcpServers["ooda-buddy-tools"]!.headers).toEqual({
      "X-Token": "sekret",
    });
  });

  it("serializes to parseable JSON", () => {
    const json = buildClaudeMcpConfigFile([server()]);
    expect(JSON.parse(json)).toEqual(buildClaudeMcpConfigDocument([server()]));
  });
});

describe("buildCodexMcpConfigArgs", () => {
  it("returns an empty fragment when there are no servers", () => {
    expect(buildCodexMcpConfigArgs([])).toEqual([]);
  });

  it("emits a `-c mcp_servers.<name>.url` override (TOML-quoted)", () => {
    expect(buildCodexMcpConfigArgs([server()])).toEqual([
      "-c",
      'mcp_servers.ooda-buddy-tools.url="http://127.0.0.1:5123/mcp/tok-abc"',
    ]);
  });

  it("emits an extra `-c` override per header", () => {
    const args = buildCodexMcpConfigArgs([
      server({ headers: [{ name: "X-Token", value: "sekret" }] }),
    ]);
    expect(args).toEqual([
      "-c",
      'mcp_servers.ooda-buddy-tools.url="http://127.0.0.1:5123/mcp/tok-abc"',
      "-c",
      'mcp_servers.ooda-buddy-tools.http_headers.X-Token="sekret"',
    ]);
  });
});

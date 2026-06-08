import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleAgentRequest } from "../grok-acp";

describe("handleAgentRequest", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "grok-fs-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("reads a text file relative to the workspace", () => {
    writeFileSync(join(workspace, "note.txt"), "hello grok");
    const result = handleAgentRequest(workspace, "fs/read_text_file", {
      path: "note.txt",
    }) as { content: string };
    expect(result.content).toBe("hello grok");
  });

  it("writes a text file (creating parent dirs) within the workspace", () => {
    handleAgentRequest(workspace, "fs/write_text_file", {
      path: "src/new.ts",
      content: "export const x = 1;",
    });
    expect(readFileSync(join(workspace, "src/new.ts"), "utf8")).toBe(
      "export const x = 1;",
    );
  });

  it("rejects paths that escape the workspace root", () => {
    expect(() =>
      handleAgentRequest(workspace, "fs/read_text_file", {
        path: "../../etc/passwd",
      }),
    ).toThrow(/escapes workspace/);
  });

  it("auto-grants permission by selecting an allow option", () => {
    const result = handleAgentRequest(workspace, "session/request_permission", {
      options: [
        { optionId: "reject-1", kind: "reject_once" },
        { optionId: "allow-1", kind: "allow_once" },
      ],
    }) as { outcome: { outcome: string; optionId?: string } };
    expect(result.outcome.outcome).toBe("selected");
    expect(result.outcome.optionId).toBe("allow-1");
  });

  it("returns null for unhandled methods", () => {
    expect(handleAgentRequest(workspace, "unknown/method", {})).toBeNull();
  });
});

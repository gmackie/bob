import { describe, expect, it } from "vitest";

import { createToolRegistry, getToolsList } from "../index.js";

describe("Bob tool registry for smol-agent task execution", () => {
  it("includes workflow, task, and PR tools required by the execution profile", () => {
    const tools = getToolsList(createToolRegistry()).map((tool) => tool.name);

    expect(tools).toContain("update_status");
    expect(tools).toContain("request_input");
    expect(tools).toContain("mark_blocked");
    expect(tools).toContain("create_pr");
    expect(tools).toContain("submit_for_review");
    expect(tools).toContain("complete_task");
  });
});

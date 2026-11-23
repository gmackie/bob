import { describe, expect, it } from "vitest";

import {
  extractPlanningDrafts,
  PLANNING_DRAFT_INSTRUCTION,
} from "../extract-plan-drafts.js";

const BLOCK = [
  "```bob-plan",
  JSON.stringify({
    tasks: [
      {
        title: "Add the session screen",
        description: "The plan is visible on the phone.",
        kind: "task",
        priority: "high",
        dependsOn: [],
      },
      {
        title: "Run the drafted task",
        description: "Bob executes it.",
        kind: "story",
        priority: "No Priority",
        dependsOn: ["Add the session screen"],
      },
    ],
  }),
  "```",
].join("\n");

describe("extractPlanningDrafts", () => {
  it("reads a fenced task list from plain text", () => {
    const tasks = extractPlanningDrafts(`Analysis first.\n\n${BLOCK}\n`);
    expect(tasks).toEqual([
      {
        title: "Add the session screen",
        description: "The plan is visible on the phone.",
        kind: "task",
        priority: "high",
        dependsOn: [],
      },
      {
        title: "Run the drafted task",
        description: "Bob executes it.",
        kind: "task",
        priority: "no_priority",
        dependsOn: ["Add the session screen"],
      },
    ]);
  });

  it("reads the fence from a Claude assistant stream", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: BLOCK }] },
    });
    expect(extractPlanningDrafts(`${line}\n`).map((task) => task.title)).toEqual([
      "Add the session screen",
      "Run the drafted task",
    ]);
  });

  it("reads the fence from a Codex agent message", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: BLOCK },
    });
    expect(extractPlanningDrafts(line)).toHaveLength(2);
  });

  it("reads a fence that is still escaped inside provider JSON", () => {
    const escaped = JSON.stringify({ type: "result", result: BLOCK });
    expect(extractPlanningDrafts(escaped)[0]?.title).toBe("Add the session screen");
  });

  it("keeps the last valid block and drops the example title", () => {
    const first = ["```bob-plan", '{"tasks":[{"title":"First pass"}]}', "```"].join("\n");
    const example = PLANNING_DRAFT_INSTRUCTION;
    const tasks = extractPlanningDrafts(`${first}\n${example}\n${BLOCK}`);
    expect(tasks.map((task) => task.title)).toEqual([
      "Add the session screen",
      "Run the drafted task",
    ]);
  });

  it("returns nothing when the agent has not closed a task block", () => {
    expect(extractPlanningDrafts("Still looking through the repo.")).toEqual([]);
    expect(extractPlanningDrafts("```bob-plan\n{not json}\n```")).toEqual([]);
  });
});

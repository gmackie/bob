import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkItemDetailCard } from "../work-item-detail-card";

function renderCard(kind: "issue" | "epic" | "task"): string {
  return renderToStaticMarkup(
    React.createElement(WorkItemDetailCard, {
      workItem: {
        id: "task-123",
        identifier: "BUILD-12",
        title: "Add merged workspace route",
        description: "Make task execution directly reachable from planning.",
        kind,
        status: "in_progress",
        project: {
          id: "project-123",
          name: "Builder",
          key: "BUILD",
        },
      },
      childCount: 2,
      comments: [],
      currentArtifacts: [],
    }),
  );
}

describe("WorkItemDetailCard", () => {
  it("shows the execution workspace CTA for tasks", () => {
    const html = renderCard("task");

    expect(html).toContain("/work-items/task-123/workspace");
    expect(html).toContain("Open execution workspace");
  });

  it("does not show the execution workspace CTA for non-task work items", () => {
    const html = renderCard("issue");

    expect(html).not.toContain("/work-items/task-123/workspace");
    expect(html).not.toContain("Open execution workspace");
  });
});

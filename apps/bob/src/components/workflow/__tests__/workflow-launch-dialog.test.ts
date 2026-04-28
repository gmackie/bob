import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("@bob/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
}));

vi.mock("@bob/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
    React.createElement("textarea", props),
}));

vi.mock("@bob/ui/dialog", () => ({
  DialogFooter: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
}));

import {
  buildWorkflowLaunchContext,
  WorkflowLaunchDialogBody,
  getWorkflowLaunchExperience,
} from "../workflow-launch-dialog";

const workItem = {
  id: "epic-1",
  identifier: "EPIC-0040",
  title: "Priority system for work items",
  kind: "epic",
};

describe("getWorkflowLaunchExperience", () => {
  it("builds a shaping experience for early feature work", () => {
    const experience = getWorkflowLaunchExperience({
      intent: "shape",
      workItem,
      requirementCount: 2,
      childTaskCount: 0,
    });

    expect(experience.title).toBe("Shape with Bob");
    expect(experience.skills).toContain("work-item-shaping");
    expect(experience.repoSources.some((source) => source.path === "README.md")).toBe(
      true,
    );
  });

  it("builds a task-breakdown experience with requirement and task signals", () => {
    const experience = getWorkflowLaunchExperience({
      intent: "breakdown",
      workItem,
      requirementCount: 12,
      childTaskCount: 3,
    });

    expect(experience.title).toBe("Break into tasks");
    expect(experience.skills).toContain("work-item-breakdown");
    expect(
      experience.repoSources.some((source) =>
        source.label.includes("Requirements checklist"),
      ),
    ).toBe(true);
    expect(
      experience.repoSources.some((source) =>
        source.label.includes("Existing child tasks"),
      ),
    ).toBe(true);
  });
});

describe("WorkflowLaunchDialogBody", () => {
  it("renders the shaping modal body with context and repository surfaces", () => {
    const experience = getWorkflowLaunchExperience({
      intent: "shape",
      workItem,
      requirementCount: 2,
      childTaskCount: 0,
    });

    const markup = renderToStaticMarkup(
      React.createElement(WorkflowLaunchDialogBody, {
        experience,
        notes: experience.defaultNotes,
        selectedSourceIds: experience.repoSources
          .filter((source) => source.defaultSelected)
          .map((source) => source.id),
        attachedFiles: [],
        isSubmitting: false,
        onNotesChange: () => {},
        onToggleSource: () => {},
        onBrowseFiles: () => {},
        onRemoveFile: () => {},
        onDropFiles: () => {},
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );

    expect(markup).toContain("Shape with Bob");
    expect(markup).toContain("Drag in context");
    expect(markup).toContain("Pull from repository");
    expect(markup).toContain("README.md");
    expect(markup).toContain("work-item-shaping");
    expect(markup).toContain("Prototype handoff");
    expect(markup).toContain("Open shaping session");
  });

  it("renders attached files and task-breakdown guidance", () => {
    const experience = getWorkflowLaunchExperience({
      intent: "breakdown",
      workItem,
      requirementCount: 12,
      childTaskCount: 5,
    });

    const markup = renderToStaticMarkup(
      React.createElement(WorkflowLaunchDialogBody, {
        experience,
        notes: experience.defaultNotes,
        selectedSourceIds: experience.repoSources.map((source) => source.id),
        attachedFiles: [
          { id: "file-1", name: "priority-brd.md", sizeLabel: "18 KB" },
          { id: "file-2", name: "board-state.png", sizeLabel: "1.2 MB" },
        ],
        isSubmitting: false,
        onNotesChange: () => {},
        onToggleSource: () => {},
        onBrowseFiles: () => {},
        onRemoveFile: () => {},
        onDropFiles: () => {},
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );

    expect(markup).toContain("Break into tasks");
    expect(markup).toContain("work-item-breakdown");
    expect(markup).toContain("priority-brd.md");
    expect(markup).toContain("Requirements checklist");
    expect(markup).toContain("Existing child tasks");
    expect(markup).toContain("Open planning session");
  });
});

describe("buildWorkflowLaunchContext", () => {
  it("expands selected repository sources into a structured planning kickoff payload", () => {
    const experience = getWorkflowLaunchExperience({
      intent: "shape",
      workItem,
      requirementCount: 2,
      childTaskCount: 0,
    });

    const context = buildWorkflowLaunchContext({
      experience,
      notes: "Use the README and planning docs to shape this into a clean epic.",
      selectedSourceIds: ["parent-work-item", "repo-readme", "repo-plans"],
      attachedFiles: [
        {
          id: "file-1",
          name: "launch-brief.md",
          sizeLabel: "12 KB",
          content: "# Brief\n\nKeep the BRD lightweight and focused on outcomes.",
        },
      ],
      workItem,
    });

    expect(context).toEqual({
      intent: "shape",
      notes: "Use the README and planning docs to shape this into a clean epic.",
      workItem,
      selectedRepoSources: [
        {
          id: "parent-work-item",
          label: "Parent work item",
          path: "EPIC-0040",
          detail: "Carry the current title and description into the shaping conversation.",
        },
        {
          id: "repo-readme",
          label: "Project overview",
          path: "README.md",
          detail: "Anchor the conversation in product language, setup context, and existing capabilities.",
        },
        {
          id: "repo-plans",
          label: "Planning docs",
          path: "docs/ai",
          detail: "Pull prior proposals, product notes, and implementation plans if this work already exists on paper.",
        },
      ],
      attachedFiles: [
        {
          name: "launch-brief.md",
          sizeLabel: "12 KB",
          content: "# Brief\n\nKeep the BRD lightweight and focused on outcomes.",
        },
      ],
    });
  });
});

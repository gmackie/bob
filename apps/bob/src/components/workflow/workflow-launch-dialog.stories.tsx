import type { Meta, StoryObj } from "@storybook/react";

import { WorkflowLaunchDialogBody, getWorkflowLaunchExperience } from "./workflow-launch-dialog";

const baseWorkItem = {
  id: "epic-1",
  identifier: "EPIC-0040",
  title: "Priority system for work items",
  kind: "epic",
};

const meta: Meta<typeof WorkflowLaunchDialogBody> = {
  title: "Workflow/Launch Dialog",
  component: WorkflowLaunchDialogBody,
  args: {
    experience: getWorkflowLaunchExperience({
      intent: "shape",
      workItem: baseWorkItem,
      requirementCount: 3,
      childTaskCount: 0,
    }),
    notes:
      "Help shape EPIC-0040 into a clearer epic or issue. Ask one question at a time and capture a BRD if the work stays broad.",
    selectedSourceIds: ["parent-work-item", "repo-readme"],
    attachedFiles: [],
    isSubmitting: false,
    onNotesChange: () => {},
    onToggleSource: () => {},
    onBrowseFiles: () => {},
    onRemoveFile: () => {},
    onDropFiles: () => {},
    onSubmit: () => {},
    onCancel: () => {},
  },
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

type Story = StoryObj<typeof WorkflowLaunchDialogBody>;

export const ShapeSession: Story = {};

export const BreakdownSession_WithAttachments: Story = {
  args: {
    experience: getWorkflowLaunchExperience({
      intent: "breakdown",
      workItem: baseWorkItem,
      requirementCount: 12,
      childTaskCount: 5,
    }),
    notes:
      "Break the parent scope into child tasks, assign primary requirement owners, and only add dependencies where order is real.",
    selectedSourceIds: [
      "parent-work-item",
      "repo-brd",
      "repo-requirements",
      "repo-children",
    ],
    attachedFiles: [
      { id: "brd", name: "priority-system-brd.md", sizeLabel: "18 KB" },
      { id: "capture", name: "board-current-state.png", sizeLabel: "1.2 MB" },
    ],
  },
};

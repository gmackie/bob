import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KanbanCardOverlay } from "@/components/tasks/kanban-card";
import { TaskList } from "@/components/tasks/task-list";
import { TaskRow } from "@/components/tasks/task-row";

const bobTask = {
  id: "task-bob",
  identifier: "ENG-201",
  title: "Fix the launch handoff flow",
  status: "in_progress" as const,
  priority: "high" as const,
  createdAt: new Date("2026-03-10T08:00:00.000Z"),
  bobView: {
    hasActiveRun: true,
    needsInput: true,
    inReview: true,
    hasPr: true,
    verificationStatus: "passed" as const,
    latestSummary: "Waiting on a product decision before landing the PR.",
  },
};

describe("Bob indicators", () => {
  it("renders compact Bob indicators on task rows", () => {
    render(<TaskRow task={bobTask} onClick={vi.fn()} />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.getByText("In review")).toBeInTheDocument();
    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("elevates needs-input Bob issues to the top of the list", () => {
    render(
      <TaskList
        tasks={[
          {
            id: "task-normal",
            identifier: "ENG-202",
            title: "Normal issue without Bob work",
            status: "todo",
            priority: "medium",
            createdAt: new Date("2026-03-10T09:00:00.000Z"),
          },
          bobTask,
        ]}
        onTaskClick={vi.fn()}
      />,
    );

    const rowTitles = screen.getAllByText(/issue|handoff flow/i);
    expect(rowTitles[0]).toHaveTextContent("Fix the launch handoff flow");
  });

  it("shows Bob indicators on kanban cards", () => {
    render(<KanbanCardOverlay task={bobTask} />);

    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
});

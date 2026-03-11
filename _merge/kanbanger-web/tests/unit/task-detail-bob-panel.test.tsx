import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDetail } from "@/components/tasks/task-detail";

const baseTask = {
  id: "task-1",
  identifier: "ENG-123",
  title: "Add Bob integration panel",
  description: "Implement the issue detail sidebar integration.",
  status: "in_progress" as const,
  priority: "high" as const,
  createdAt: new Date("2026-03-10T10:00:00.000Z"),
  updatedAt: new Date("2026-03-10T11:00:00.000Z"),
  labels: [],
};

describe("TaskDetail Bob panel", () => {
  it("renders the active Bob panel summary, latest artifacts, and run history", () => {
    render(
      <TaskDetail
        task={{
          ...baseTask,
          bobRun: {
            id: "run-active",
            status: "in_progress",
            latestSummary: "Waiting on a copy decision before landing the PR.",
            externalSessionUrl: "https://bob.example/sessions/active",
            reviewUrl: "https://github.com/acme/repo/pull/42",
            claimedAt: new Date("2026-03-10T10:15:00.000Z"),
            completedAt: null,
            session: {
              id: "session-active",
              workflowStatus: "awaiting_input",
            },
          },
          bobRunHistory: [
            {
              id: "run-active",
              status: "in_progress",
              latestSummary: "Waiting on a copy decision before landing the PR.",
              externalSessionUrl: "https://bob.example/sessions/active",
              claimedAt: new Date("2026-03-10T10:15:00.000Z"),
              completedAt: null,
              session: {
                id: "session-active",
                workflowStatus: "awaiting_input",
              },
            },
            {
              id: "run-old",
              status: "superseded",
              latestSummary: "Superseded after repo mapping changed.",
              externalSessionUrl: "https://bob.example/sessions/old",
              claimedAt: new Date("2026-03-09T10:15:00.000Z"),
              completedAt: new Date("2026-03-09T12:15:00.000Z"),
              session: {
                id: "session-old",
                workflowStatus: "working",
              },
            },
          ],
          currentArtifacts: [
            {
              id: "artifact-pr",
              artifactType: "pr",
              artifactRole: "review",
              title: "PR #42",
              url: "https://github.com/acme/repo/pull/42",
              summary: "Ready for review",
              isCurrent: true,
            },
            {
              id: "artifact-verification",
              artifactType: "verification",
              artifactRole: "verification",
              title: "Verification passed",
              url: "https://ci.example/runs/42",
              summary: "Unit and integration checks passed",
              isCurrent: true,
            },
          ],
        } as never}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(screen.getByText("Awaiting input")).toBeInTheDocument();
    expect(
      screen.getAllByText("Waiting on a copy decision before landing the PR.").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Open Bob" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getAllByText("PR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Verification").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Run history" })).toBeInTheDocument();
    expect(screen.getByText("Superseded after repo mapping changed.")).toBeInTheDocument();
  });

  it("shows restart for historical-only Bob work and separates parent and child artifacts", () => {
    render(
      <TaskDetail
        task={{
          ...baseTask,
          status: "todo",
          bobRun: null,
          bobRunHistory: [
            {
              id: "run-historical",
              status: "handed_off",
              latestSummary: "Paused after handoff to design.",
              externalSessionUrl: "https://bob.example/sessions/historical",
              claimedAt: new Date("2026-03-08T10:15:00.000Z"),
              completedAt: new Date("2026-03-08T12:15:00.000Z"),
              session: {
                id: "session-historical",
                workflowStatus: "paused",
              },
            },
          ],
          currentArtifacts: [
            {
              id: "artifact-doc",
              artifactType: "doc",
              artifactRole: "design-doc",
              title: "Design brief",
              url: "https://docs.example/design-brief",
              summary: "Current parent issue design brief",
              isCurrent: true,
            },
          ],
          childArtifactGroups: [
            {
              issue: {
                id: "child-1",
                identifier: "ENG-124",
                title: "Implement launch button",
                status: "in_review",
              },
              artifacts: [
                {
                  id: "child-artifact-pr",
                  artifactType: "pr",
                  artifactRole: "review",
                  title: "PR #77",
                  url: "https://github.com/acme/repo/pull/77",
                  summary: "Child issue PR",
                  isCurrent: true,
                },
              ],
            },
          ],
        } as never}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Restart with Bob" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Parent artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Child artifacts" })).toBeInTheDocument();
    expect(screen.getByText("ENG-124")).toBeInTheDocument();
    expect(screen.getByText("PR #77")).toBeInTheDocument();
  });
});

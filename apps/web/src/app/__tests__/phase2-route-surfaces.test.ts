import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

vi.mock("~/components/work-items/create-work-item-button", () => ({
  CreateWorkItemButton: () => null,
}));

vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: vi.fn(async () => ({
    project: {
      get: vi.fn(async () => ({
        project: {
          id: "project-1",
          workspaceId: "workspace-1",
          key: "PLAN",
          name: "Planner",
          description: "Planning surface",
          color: "#3355aa",
          status: "active",
        },
        counts: {
          issues: 3,
          tasks: 5,
          epics: 1,
          active: 4,
        },
      })),
    },
    workItems: {
      list: vi.fn(async () => []),
    },
  })),
}));

describe("phase 2 route surfaces", () => {
  it("redirects / to /planning with a 301", async () => {
    const { middleware } = await import("~/middleware");
    const response = middleware(
      new NextRequest("https://bob.example.internal/"),
    );

    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe(
      "https://bob.example.internal/planning",
    );
  });

  it("renders the /system operations page without error", async () => {
    const module = await import("../(dashboard)/system/page");
    const markup = renderToStaticMarkup(module.default());

    expect(markup).toContain("System");
    expect(markup).toContain("Operations");
    expect(markup).toContain("Preparing system terminal");
  });

  it("renders repository controls on the project detail page", async () => {
    const module = await import("../(dashboard)/projects/[projectId]/page");
    const element = await module.default({
      params: Promise.resolve({ projectId: "project-1" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Repository controls");
  });

  it("removes the old dashboard route entrypoint", () => {
    const dashboardRoutePath = fileURLToPath(
      new URL("../(dashboard)/dashboard/page.tsx", import.meta.url),
    );

    expect(existsSync(dashboardRoutePath)).toBe(false);
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import { BranchTree } from "../branch-tree";
import type { BranchTree as BranchTreeModel } from "@gmacko/models";

const tree: BranchTreeModel = {
  branch: {
    id: "main",
    threadId: "t1",
    parentBranchId: null,
    forkPointMessageId: null,
    name: "Main",
    createdAt: new Date(),
  },
  messageCount: 5,
  children: [
    {
      branch: {
        id: "branch-a",
        threadId: "t1",
        parentBranchId: "main",
        forkPointMessageId: "m3",
        name: "Rabbit hole A",
        createdAt: new Date(),
      },
      messageCount: 3,
      children: [],
    },
    {
      branch: {
        id: "branch-b",
        threadId: "t1",
        parentBranchId: "main",
        forkPointMessageId: "m4",
        name: "Rabbit hole B",
        createdAt: new Date(),
      },
      messageCount: 7,
      children: [],
    },
  ],
};

describe("BranchTree", () => {
  it("renders all branches", () => {
    render(<BranchTree tree={tree} activeBranchId="main" onSelect={() => {}} />);
    expect(screen.getByText("Main")).toBeDefined();
    expect(screen.getByText("Rabbit hole A")).toBeDefined();
    expect(screen.getByText("Rabbit hole B")).toBeDefined();
  });

  it("highlights active branch", () => {
    render(<BranchTree tree={tree} activeBranchId="branch-a" onSelect={() => {}} />);
    const active = screen.getByText("Rabbit hole A").closest("[data-active]");
    expect(active?.getAttribute("data-active")).toBe("true");
  });

  it("calls onSelect when clicking a branch", () => {
    const onSelect = vi.fn();
    render(<BranchTree tree={tree} activeBranchId="main" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Rabbit hole B"));
    expect(onSelect).toHaveBeenCalledWith("branch-b");
  });
});

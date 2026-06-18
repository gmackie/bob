import { render, screen } from "@testing-library/react";
import { MessageList } from "../message-list";
import type { Message } from "@gmacko/core/models";

const messages: Message[] = [
  {
    id: "1",
    threadId: "t1",
    branchId: "b1",
    parentId: null,
    role: "user",
    content: "What is OODA?",
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "2",
    threadId: "t1",
    branchId: "b1",
    parentId: "1",
    role: "assistant",
    content: "OODA stands for Observe, Orient, Decide, Act.",
    createdAt: new Date("2026-01-01"),
  },
];

describe("MessageList", () => {
  it("renders messages", () => {
    render(<MessageList messages={messages} />);
    expect(screen.getByText("What is OODA?")).toBeDefined();
    expect(screen.getByText("OODA stands for Observe, Orient, Decide, Act.")).toBeDefined();
  });

  it("distinguishes user and assistant messages", () => {
    render(<MessageList messages={messages} />);
    const bubbles = screen.getAllByTestId("message-bubble");
    expect(bubbles[0]?.getAttribute("data-role")).toBe("user");
    expect(bubbles[1]?.getAttribute("data-role")).toBe("assistant");
  });
});

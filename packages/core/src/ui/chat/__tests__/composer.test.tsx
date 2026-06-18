import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "../composer";

describe("Composer", () => {
  it("calls onSend with message content", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.submit(input.closest("form")!);

    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("clears input after send", () => {
    render(<Composer onSend={() => {}} />);

    const input = screen.getByPlaceholderText("Type a message...") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.submit(input.closest("form")!);

    expect(input.value).toBe("");
  });

  it("disables send when empty", () => {
    render(<Composer onSend={() => {}} />);
    const button = screen.getByRole("button", { name: /send/i });
    expect(button).toBeDisabled();
  });
});

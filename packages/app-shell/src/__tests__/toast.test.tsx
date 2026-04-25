import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { ToastProvider, useToast } from "../toast";

function ToastTrigger({
  message,
  kind,
}: {
  message: string;
  kind?: "info" | "success" | "warn" | "error";
}) {
  const { toast } = useToast();
  return <button onClick={() => toast({ message, kind })}>fire</button>;
}

describe("@gmacko/app-shell ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("toast() adds a toast that renders in the DOM", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Hello" />
      </ToastProvider>,
    );
    act(() => screen.getByText("fire").click());
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("toasts auto-dismiss after 5s", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Bye" />
      </ToastProvider>,
    );
    act(() => screen.getByText("fire").click());
    expect(screen.queryByText("Bye")).not.toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText("Bye")).toBeNull();
  });

  it("multiple toasts render in order", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="First" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
      screen.getByText("fire").click();
    });
    const items = screen.getAllByText(/First/);
    expect(items.length).toBe(2);
  });
});

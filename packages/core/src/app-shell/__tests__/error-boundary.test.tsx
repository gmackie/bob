import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { EffectErrorBoundary } from "../error-boundary";

function Bomb({
  throwIt,
  errorValue,
}: {
  throwIt: boolean;
  errorValue: unknown;
}) {
  if (throwIt) throw errorValue;
  return <div>safe</div>;
}

describe("@gmacko/app-shell EffectErrorBoundary", () => {
  it("renders error.message for plain Error", () => {
    // Suppress error boundary console noise in test output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EffectErrorBoundary>
        <Bomb throwIt errorValue={new Error("boom")} />
      </EffectErrorBoundary>,
    );
    expect(screen.getByText("boom")).toBeDefined();
    spy.mockRestore();
  });

  it("renders _tag heading + payload for Effect tagged error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tagged = {
      _tag: "BadThingError",
      reason: "permission denied",
      code: 403,
    };
    render(
      <EffectErrorBoundary>
        <Bomb throwIt errorValue={tagged} />
      </EffectErrorBoundary>,
    );
    expect(screen.getByText("BadThingError")).toBeDefined();
    expect(screen.getByText("reason")).toBeDefined();
    expect(screen.getByText("permission denied")).toBeDefined();
    expect(screen.getByText("code")).toBeDefined();
    spy.mockRestore();
  });

  it("reset button clears error state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let throwIt = true;
    function Wrapper() {
      return <Bomb throwIt={throwIt} errorValue={new Error("first")} />;
    }
    const { rerender } = render(
      <EffectErrorBoundary>
        <Wrapper />
      </EffectErrorBoundary>,
    );
    expect(screen.getByText("first")).toBeDefined();
    throwIt = false;
    fireEvent.click(screen.getByText("Reset"));
    rerender(
      <EffectErrorBoundary>
        <Wrapper />
      </EffectErrorBoundary>,
    );
    expect(screen.getByText("safe")).toBeDefined();
    spy.mockRestore();
  });
});

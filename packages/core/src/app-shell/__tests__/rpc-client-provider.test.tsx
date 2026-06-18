import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { RpcClientProvider, useRpcClient } from "../rpc-client-provider";

function Probe() {
  const client = useRpcClient();
  return <div data-testid="probe">{Object.keys(client).sort().join(",")}</div>;
}

describe("@gmacko/app-shell RpcClientProvider", () => {
  it("provides a client object with the expected group surface", () => {
    render(
      <RpcClientProvider options={{ baseURL: "http://localhost:0" }}>
        <Probe />
      </RpcClientProvider>,
    );
    const text = screen.getByTestId("probe").textContent ?? "";
    expect(text).toContain("agent");
    expect(text).toContain("auth");
    expect(text).toContain("projects");
    expect(text).toContain("secrets");
  });

  it("useRpcClient throws outside provider", () => {
    // Mute React 19's error logging so the test output stays clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Throws() {
      useRpcClient();
      return null;
    }
    expect(() => render(<Throws />)).toThrow(
      /useRpcClient must be used within RpcClientProvider/,
    );
    spy.mockRestore();
  });
});

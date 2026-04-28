import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthedOnly } from "../authed-only";
import { CurrentUserProvider } from "../current-user-provider";
import { RpcClientProvider } from "../rpc-client-provider";

const mockWhoAmI = vi.fn();
vi.mock("@gmacko/core/client", () => ({
  createGmackoRpcClient: () => ({
    auth: { whoAmI: mockWhoAmI },
    projects: {},
    secrets: {},
    agent: {},
  }),
}));

function setup(redirectTo = "/login") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RpcClientProvider options={{ baseURL: "http://localhost:0" }}>
        <CurrentUserProvider>
          <AuthedOnly redirectTo={redirectTo} fallback={<div>FB</div>}>
            <div>Protected</div>
          </AuthedOnly>
        </CurrentUserProvider>
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

describe("@gmacko/app-shell AuthedOnly", () => {
  let assignSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockWhoAmI.mockReset();
    assignSpy = vi.fn();
    // jsdom 26 disallows direct mutation of window.location, but
    // Object.defineProperty with configurable:true works for the test scope.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { assign: assignSpy, href: "" },
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("renders fallback while loading", () => {
    mockWhoAmI.mockImplementation(() => new Promise(() => {}));
    setup();
    expect(screen.queryByText("FB")).not.toBeNull();
    expect(screen.queryByText("Protected")).toBeNull();
  });

  it("renders children when authenticated", async () => {
    mockWhoAmI.mockResolvedValueOnce({
      userId: "u1",
      tenantId: "t1",
      email: "x@y",
      role: "owner",
    });
    setup();
    await waitFor(() => {
      expect(screen.queryByText("Protected")).not.toBeNull();
    });
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("calls window.location.assign(redirectTo) when whoAmI fails", async () => {
    mockWhoAmI.mockRejectedValueOnce(new Error("nope"));
    setup("/auth/login");
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith("/auth/login");
    });
    expect(screen.queryByText("Protected")).toBeNull();
  });
});

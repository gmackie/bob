import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CurrentUserProvider, useCurrentUser } from "../current-user-provider";
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

function Probe() {
  const { data, isLoading, error } = useCurrentUser();
  if (isLoading) return <div>loading</div>;
  if (error) return <div>error: {(error as Error).message}</div>;
  if (data) return <div>user: {(data as { email: string }).email}</div>;
  return <div>empty</div>;
}

let queryClient: QueryClient;

function setup() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider options={{ baseURL: "http://localhost:0" }}>
        <CurrentUserProvider>
          <Probe />
        </CurrentUserProvider>
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

describe("@gmacko/app-shell CurrentUserProvider + useCurrentUser", () => {
  beforeEach(() => mockWhoAmI.mockReset());
  afterEach(() => {
    // Cancel any in-flight queries so a never-resolving mock doesn't keep
    // RTL's async cleanup waiting through the hook timeout.
    queryClient?.cancelQueries();
    queryClient?.clear();
    vi.clearAllMocks();
  });

  it("returns success with user data after whoAmI resolves", async () => {
    mockWhoAmI.mockResolvedValueOnce({
      userId: "u1",
      tenantId: "t1",
      email: "test@example.com",
      role: "owner",
    });
    setup();
    await waitFor(() => {
      expect(screen.queryByText("user: test@example.com")).not.toBeNull();
    });
  });

  it("returns error when whoAmI rejects", async () => {
    mockWhoAmI.mockRejectedValueOnce(new Error("nope"));
    setup();
    await waitFor(() => {
      expect(screen.queryByText(/error: nope/)).not.toBeNull();
    });
  });

  it("renders loading state initially", () => {
    // Use a deferred promise so afterEach can resolve it and free RTL's
    // async cleanup; a never-resolving Promise wedges the hook timeout.
    let resolvePending: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolvePending = resolve;
    });
    mockWhoAmI.mockImplementation(() => pending);
    setup();
    expect(screen.queryByText("loading")).not.toBeNull();
    resolvePending({
      userId: "u1",
      tenantId: "t1",
      email: "any@x",
      role: "owner",
    });
  });
});

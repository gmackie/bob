import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RpcClientProvider } from "../rpc-client-provider";
import { TenantPicker } from "../tenant-picker";

const mockListMemberships = vi.fn();
const mockResolveTenant = vi.fn();

vi.mock("@gmacko/core/client", () => ({
  createGmackoRpcClient: () => ({
    auth: {
      listMemberships: mockListMemberships,
      resolveTenant: mockResolveTenant,
    },
    projects: {},
    secrets: {},
    agent: {},
  }),
}));

let queryClient: QueryClient;

function setup(onSelect?: (id: string) => void) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider options={{ baseURL: "http://localhost:0" }}>
        <TenantPicker onSelect={onSelect} />
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

describe("@gmacko/app-shell TenantPicker", () => {
  beforeEach(() => {
    mockListMemberships.mockReset();
    mockResolveTenant.mockReset();
  });
  afterEach(() => {
    queryClient?.cancelQueries();
    queryClient?.clear();
    vi.clearAllMocks();
  });

  it("renders memberships list", async () => {
    mockListMemberships.mockResolvedValueOnce([
      { tenantId: "acme", role: "owner" },
      { tenantId: "globex", role: "member" },
    ]);
    setup();
    await waitFor(() => {
      expect(screen.queryByText(/acme/)).not.toBeNull();
    });
    expect(screen.queryByText(/globex/)).not.toBeNull();
  });

  it("clicking a tenant calls resolveTenant with that tenantId", async () => {
    mockListMemberships.mockResolvedValueOnce([
      { tenantId: "acme", role: "owner" },
      { tenantId: "globex", role: "member" },
    ]);
    mockResolveTenant.mockResolvedValueOnce({ tenantId: "globex" });
    setup();
    await waitFor(() => {
      expect(screen.queryByText(/globex/)).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /globex/ }));
    await waitFor(() => {
      expect(mockResolveTenant).toHaveBeenCalledWith({
        tenantIdHint: "globex",
      });
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CurrentUserProvider } from "../current-user-provider";
import { DeviceFlowEntry } from "../device-flow-entry";
import { RpcClientProvider } from "../rpc-client-provider";

const mockWhoAmI = vi.fn();
const mockApproveDeviceCode = vi.fn();

vi.mock("@gmacko/client", () => ({
  createGmackoRpcClient: () => ({
    auth: {
      whoAmI: mockWhoAmI,
      approveDeviceCode: mockApproveDeviceCode,
    },
    projects: {},
    secrets: {},
    agent: {},
  }),
}));

let queryClient: QueryClient;

function setup(onSuccess?: () => void) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RpcClientProvider options={{ baseURL: "http://localhost:0" }}>
        <CurrentUserProvider>
          <DeviceFlowEntry onSuccess={onSuccess} />
        </CurrentUserProvider>
      </RpcClientProvider>
    </QueryClientProvider>,
  );
}

describe("@gmacko/app-shell DeviceFlowEntry", () => {
  beforeEach(() => {
    mockWhoAmI.mockReset();
    mockApproveDeviceCode.mockReset();
  });
  afterEach(() => {
    queryClient?.cancelQueries();
    queryClient?.clear();
    vi.clearAllMocks();
  });

  it("submitting calls approveDeviceCode with the entered code + tenantId", async () => {
    mockWhoAmI.mockResolvedValueOnce({
      userId: "u1",
      tenantId: "t-active",
      email: "x@y",
      role: "owner",
    });
    mockApproveDeviceCode.mockResolvedValueOnce({ ok: true });
    setup();
    // Wait until currentUser resolves so the submit button is enabled.
    await waitFor(() => {
      const btn = screen.getByRole("button", {
        name: /approve/i,
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText(/user code/i), {
      target: { value: "abcd-efgh" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => {
      expect(mockApproveDeviceCode).toHaveBeenCalledWith({
        userCode: "ABCD-EFGH",
        tenantId: "t-active",
      });
    });
  });

  it("success triggers onSuccess callback", async () => {
    mockWhoAmI.mockResolvedValueOnce({
      userId: "u1",
      tenantId: "t-active",
      email: "x@y",
      role: "owner",
    });
    mockApproveDeviceCode.mockResolvedValueOnce({ ok: true });
    const onSuccess = vi.fn();
    setup(onSuccess);
    await waitFor(() => {
      const btn = screen.getByRole("button", {
        name: /approve/i,
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText(/user code/i), {
      target: { value: "ZZZZ-YYYY" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});

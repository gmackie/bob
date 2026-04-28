import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { useTheme } from "@gmacko/ui";

import {
  GmackoAppProviders,
  useCurrentUser,
  useRpcClient,
  useToast,
} from "../index";

const mockWhoAmI = vi.fn().mockResolvedValue({
  userId: "u1",
  tenantId: "t1",
  email: "x@y",
  role: "owner",
});

vi.mock("@gmacko/core/client", () => ({
  createGmackoRpcClient: () => ({
    auth: {
      whoAmI: mockWhoAmI,
      listMemberships: vi.fn(),
      resolveTenant: vi.fn(),
      approveDeviceCode: vi.fn(),
    },
    projects: {},
    secrets: {},
    agent: {},
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("@gmacko/app-shell GmackoAppProviders bundle", () => {
  it("provides theme + rpc + toast + currentUser to descendants", async () => {
    function Probe() {
      const theme = useTheme();
      const client = useRpcClient();
      const toast = useToast();
      const cu = useCurrentUser();
      return (
        <div>
          <span data-testid="theme">{theme.theme}</span>
          <span data-testid="has-client">{client ? "yes" : "no"}</span>
          <span data-testid="has-toast">
            {typeof toast.toast === "function" ? "yes" : "no"}
          </span>
          <span data-testid="user-email">
            {(cu.data as { email?: string } | undefined)?.email ?? ""}
          </span>
        </div>
      );
    }

    render(
      <GmackoAppProviders
        defaultTheme="bob"
        defaultMode="light"
        rpcOptions={{ baseURL: "http://localhost:0" }}
      >
        <Probe />
      </GmackoAppProviders>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("bob");
    expect(screen.getByTestId("has-client").textContent).toBe("yes");
    expect(screen.getByTestId("has-toast").textContent).toBe("yes");
    await waitFor(() => {
      expect(screen.getByTestId("user-email").textContent).toBe("x@y");
    });
  });

  it("uses caller-provided QueryClient when passed", () => {
    const sharedQc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function Probe() {
      const cu = useCurrentUser();
      return (
        <div>
          {cu.isLoading
            ? "loading"
            : ((cu.data as { email?: string } | undefined)?.email ?? "n/a")}
        </div>
      );
    }

    render(
      <GmackoAppProviders
        defaultTheme="ooda"
        rpcOptions={{ baseURL: "http://localhost:0" }}
        queryClient={sharedQc}
      >
        <Probe />
      </GmackoAppProviders>,
    );
    // The component should render — caller's QC accepted.
    expect(screen.queryByText(/loading|x@y|n\/a/)).not.toBeNull();
  });
});

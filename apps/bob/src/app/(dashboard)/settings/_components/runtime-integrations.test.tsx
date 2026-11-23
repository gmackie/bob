import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { resolveIntegrationConfig } from "@bob/config/integrations";

import { IntegrationsSection } from "./integrations";

vi.mock("~/rpc/react", () => ({
  useBobRpcClient: () => ({
    planning: { listWorkspaces: () => Promise.resolve([]) },
  }),
}));

describe("runtime integration settings", () => {
  it.each([
    {},
    { BOB_STRIPE_ENABLED: "true", STRIPE_SECRET_KEY: "rk_test_fixtureOnly" },
    { SENTRY_DSN: "private-malformed-fixture" },
    {
      SENTRY_DSN: "https://fixturePublicKey@sentry.example/1",
      POSTHOG_KEY: "phc_fixtureOnly",
    },
  ])("shows API status and reasons even without a workspace", (env) => {
    const statuses = resolveIntegrationConfig(env);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      ["integration-configuration"],
      JSON.parse(JSON.stringify(statuses)),
    );
    client.setQueryData(["rpc", "planning.listWorkspaces"], []);
    try {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <IntegrationsSection />
        </QueryClientProvider>,
      );
      expect(html).toContain("Create a workspace first");
      for (const status of Object.values(statuses)) {
        expect(html).toContain(status.name);
        expect(html).toContain(status.status.replaceAll("_", " "));
        expect(html).toContain(status.reason);
      }
      expect(html).not.toContain("private-malformed-fixture");
      expect(html).not.toContain("fixturePublicKey");
      expect(html).not.toContain("rk_test_fixtureOnly");
    } finally {
      client.clear();
    }
  });
});

"use client";

import { Badge } from "@gmacko/core/ui/badge";
import { useQuery } from "@tanstack/react-query";

import type { IntegrationStatuses } from "@bob/config/integrations";

export function RuntimeIntegrationStatusList({
  statuses,
}: {
  statuses: IntegrationStatuses;
}) {
  return (
    <ul className="divide-border divide-y">
      {Object.entries(statuses).map(([id, integration]) => (
        <li key={id} className="py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{integration.name}</span>
            <Badge variant={integration.enabled ? "emerald" : "default"}>
              {integration.status.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {integration.reason}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function RuntimeIntegrations() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["integration-configuration"],
    queryFn: async (): Promise<IntegrationStatuses> => {
      const response = await fetch("/api/integrations/configuration", {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Unable to load integration configuration.");
      return response.json() as Promise<IntegrationStatuses>;
    },
    staleTime: 30_000,
  });
  return (
    <section aria-label="Runtime integration configuration">
      <h3 className="text-sm font-medium">Runtime configuration</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Service configuration for this deployment.
      </p>
      {isPending ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Loading configuration...
        </p>
      ) : null}
      {isError ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          Unable to load integration configuration.
        </p>
      ) : null}
      {data ? <RuntimeIntegrationStatusList statuses={data} /> : null}
    </section>
  );
}

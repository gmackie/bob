"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { ConnectorStatusCard } from "~/components/health/connector-status-card";

// `runner.getHealth` is `.output(z.any())` for OpenAPI, which degenerates the
// client query type; mirror the connector-status shape the resolver returns.
interface ConnectorHealth {
  connectorId: string;
  status: "up" | "degraded" | "down" | "unknown";
  rateLimitRemaining: number | undefined;
  lastSuccessAt: string | undefined;
  errorCount: number;
  avgResponseMs: number | undefined;
}

export default function HealthPage() {
  const trpc = useTRPC();
  const healthQuery = useQuery({
    ...trpc.runner.getHealth.queryOptions(),
    refetchInterval: 5_000,
  });

  const connectors = (healthQuery.data ?? []) as unknown as ConnectorHealth[];

  const upCount = connectors.filter((c) => c.status === "up").length;
  const degradedCount = connectors.filter((c) => c.status === "degraded").length;
  const downCount = connectors.filter((c) => c.status === "down").length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <h1 className="font-serif text-2xl text-primary">
          Source Health Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real-time connector status and rate limit monitoring.
        </p>

        {/* Summary bar */}
        <div className="mt-4 flex items-center gap-4 rounded-[6px] border border-border bg-card px-4 py-2.5 text-sm font-mono">
          {healthQuery.isLoading ? (
            <span className="text-subtle">Loading...</span>
          ) : healthQuery.isError ? (
            <span className="text-destructive">Health check unavailable</span>
          ) : (
            <>
              <span className="text-[#4A9E6B]">{upCount} up</span>
              <span className="text-subtle">/</span>
              <span className="text-[#C49A3C]">{degradedCount} degraded</span>
              <span className="text-subtle">/</span>
              <span className="text-destructive">{downCount} down</span>
            </>
          )}
        </div>

        {healthQuery.isError ? (
          <div className="mt-6 rounded-[6px] border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
            <p className="text-sm text-destructive">
              Couldn&apos;t reach the runner health endpoint.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {healthQuery.error instanceof Error
                ? healthQuery.error.message
                : "Retrying every 5 seconds."}
            </p>
          </div>
        ) : !healthQuery.isLoading && connectors.length === 0 ? (
          <div className="mt-6 rounded-[6px] border border-border bg-card px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No connectors configured yet.</p>
            <p className="mt-1 text-xs text-subtle">
              Connector status will appear here once a runner registers a source.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {connectors.map((c) => (
              <ConnectorStatusCard
                key={c.connectorId}
                connectorId={c.connectorId}
                status={c.status}
                rateLimitRemaining={c.rateLimitRemaining ?? undefined}
                lastSuccessAt={c.lastSuccessAt ?? undefined}
                errorCount={c.errorCount}
                avgResponseMs={c.avgResponseMs ?? undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

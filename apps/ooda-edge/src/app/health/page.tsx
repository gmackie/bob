"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { ConnectorStatusCard } from "~/components/health/connector-status-card";

// Shape of `runner.getHealth` items. The procedure declares `.output(z.any())`
// (required by trpc-to-openapi), which degenerates the client-inferred type,
// so we re-attach the real resolver shape here.
interface ConnectorHealth {
  connectorId: string;
  status: "up" | "degraded" | "down" | "unknown";
  rateLimitRemaining: number | undefined;
  lastSuccessAt: string | undefined;
  errorCount: number;
  avgResponseMs: number | undefined;
}

// Shape of a `runner.listDevices` row (also `.output(z.any())`). Only the
// fields the credential panel needs are declared.
interface RunnerDevice {
  id: string;
  name: string;
  capabilities: string[];
  credHealth: Record<string, { status: string; detail?: string }> | null;
  credHealthOk: boolean | null;
  credHealthAt: string | null;
}

export default function HealthPage() {
  const trpc = useTRPC();
  const healthQuery = useQuery({
    ...trpc.runner.getHealth.queryOptions(),
    refetchInterval: 5_000,
  });

  const connectors = (healthQuery.data as ConnectorHealth[] | undefined) ?? [];

  const upCount = connectors.filter((c) => c.status === "up").length;
  const degradedCount = connectors.filter((c) => c.status === "degraded").length;
  const downCount = connectors.filter((c) => c.status === "down").length;

  const devicesQuery = useQuery({
    ...trpc.runner.listDevices.queryOptions(),
    refetchInterval: 15_000,
  });

  // Only surface runners that have actually reported credential health.
  const credDevices = (
    (devicesQuery.data as RunnerDevice[] | undefined) ?? []
  ).filter((d) => d.credHealth && Object.keys(d.credHealth).length > 0);

  return (
    <div className="min-h-screen bg-[#111113] text-[#E8E4DF]">
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <h1 className="font-serif text-2xl text-[#D4A04A]">
          Source Health Dashboard
        </h1>
        <p className="mt-1 text-sm text-[#8A8580]">
          Real-time connector status and rate limit monitoring.
        </p>

        {/* Summary bar */}
        <div className="mt-4 flex items-center gap-4 rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] px-4 py-2.5 text-sm font-mono">
          {healthQuery.isLoading ? (
            <span className="text-[#5A5855]">Loading...</span>
          ) : (
            <>
              <span className="text-[#4A9E6B]">{upCount} up</span>
              <span className="text-[#5A5855]">/</span>
              <span className="text-[#C49A3C]">{degradedCount} degraded</span>
              <span className="text-[#5A5855]">/</span>
              <span className="text-[#C45454]">{downCount} down</span>
            </>
          )}
        </div>

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

        {/* Runner adapter credentials — sourced from each runner's
            adapter-cred-health probe, reported on register/heartbeat. An
            expired adapter OAuth silently fails that adapter's runs until
            it is re-authed, so surface it here. */}
        {credDevices.length > 0 && (
          <div className="mt-8">
            <h2 className="font-serif text-lg text-[#D4A04A]">
              Runner adapter credentials
            </h2>
            <p className="mt-1 text-sm text-[#8A8580]">
              Per-agent auth health reported by each runner.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              {credDevices.map((d) => (
                <div
                  key={d.id}
                  className="rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-[#E8E4DF]">
                      {d.name}
                    </span>
                    <span
                      className={
                        d.credHealthOk === false
                          ? "text-xs text-[#C45454]"
                          : "text-xs text-[#4A9E6B]"
                      }
                    >
                      {d.credHealthOk === false ? "needs attention" : "all ok"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {Object.entries(d.credHealth ?? {}).map(([adapter, h]) => {
                      const ok = h.status === "OK";
                      const bad =
                        h.status === "EXPIRED" || h.status === "MISSING";
                      return (
                        <div
                          key={adapter}
                          className="flex items-center justify-between text-sm"
                          title={h.detail}
                        >
                          <span className="font-mono text-[#8A8580]">
                            {adapter}
                          </span>
                          <span
                            className={
                              ok
                                ? "text-[#4A9E6B]"
                                : bad
                                  ? "text-[#C45454]"
                                  : "text-[#C49A3C]"
                            }
                          >
                            {h.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {d.credHealthAt && (
                    <p className="mt-3 font-mono text-[11px] text-[#5A5855]">
                      checked {new Date(d.credHealthAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

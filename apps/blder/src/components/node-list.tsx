"use client";

import { useEffect, useState } from "react";

interface RunnerNode {
  id: string;
  name: string;
  hostname: string | null;
  status: string;
  lastHeartbeatAt: string | null;
  capabilities: string[];
  registeredAt: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(iso: string | null): boolean {
  if (!iso) return true;
  // Consider stale if no heartbeat in the last 5 minutes
  return Date.now() - new Date(iso).getTime() > 5 * 60 * 1000;
}

export function NodeList() {
  const [nodes, setNodes] = useState<RunnerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchNodes() {
      try {
        const res = await fetch("/api/nodes");
        if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
        const data = (await res.json()) as RunnerNode[];
        if (!cancelled) {
          setNodes(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch nodes");
          setLoading(false);
        }
      }
    }

    void fetchNodes();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading nodes...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
        {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-secondary px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No runner devices registered yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            <th className="px-4 py-3 font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-3 font-medium text-muted-foreground">
              Name
            </th>
            <th className="hidden px-4 py-3 font-medium text-muted-foreground sm:table-cell">
              Hostname
            </th>
            <th className="hidden px-4 py-3 font-medium text-muted-foreground md:table-cell">
              Capabilities
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">
              Last Heartbeat
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const stale = isStale(node.lastHeartbeatAt);
            const online = node.status === "online" && !stale;
            return (
              <tr
                key={node.id}
                className="border-b border-border last:border-b-0 transition hover:bg-secondary/30"
              >
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        online
                          ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,.5)]"
                          : "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,.4)]"
                      }`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {online ? "online" : "offline"}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {node.name}
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {node.hostname ?? "--"}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {node.capabilities.length > 0
                      ? node.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="inline-flex rounded-md border border-border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground"
                          >
                            {cap}
                          </span>
                        ))
                      : <span className="text-xs text-muted-foreground">--</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {relativeTime(node.lastHeartbeatAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

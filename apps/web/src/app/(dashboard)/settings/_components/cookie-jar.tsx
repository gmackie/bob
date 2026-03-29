"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function CookieJar() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: cookies, isLoading } = useQuery(
    trpc.cookies.list.queryOptions(undefined),
  );

  const removeMutation = useMutation(
    trpc.cookies.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.cookies.list.queryKey(),
        });
      },
    }),
  );

  if (isLoading) {
    return (
      <section className="rounded-lg border p-6">
        <div className="animate-pulse space-y-4">
          <div className="bg-muted h-16 rounded" />
          <div className="bg-muted h-16 rounded" />
        </div>
      </section>
    );
  }

  if (!cookies || cookies.length === 0) {
    return (
      <section className="rounded-lg border p-6">
        <p className="text-muted-foreground">
          No cookies imported yet. Use the browser extension or CLI to import
          cookies.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-6">
      <div className="text-muted-foreground mb-4 text-xs">
        Imported cookies available to agent sessions. Values are encrypted and
        never displayed.
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b border-border text-xs">
            <th className="py-2 text-left">Domain</th>
            <th className="py-2 text-left">Cookies</th>
            <th className="py-2 text-left">Source</th>
            <th className="py-2 text-left">Updated</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((entry) => (
            <tr
              key={`${entry.domain}-${entry.source}`}
              className="border-b border-border/50"
            >
              <td className="py-2 font-mono text-xs">{entry.domain}</td>
              <td className="py-2">{entry.count}</td>
              <td className="py-2 text-muted-foreground">{entry.source}</td>
              <td className="text-muted-foreground py-2 text-xs">
                {entry.lastUpdated
                  ? new Date(entry.lastUpdated).toLocaleDateString()
                  : "\u2014"}
              </td>
              <td className="py-2 text-right">
                <button
                  onClick={() =>
                    removeMutation.mutate({ domain: entry.domain })
                  }
                  disabled={removeMutation.isPending}
                  className="text-destructive hover:text-destructive/80 text-xs"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

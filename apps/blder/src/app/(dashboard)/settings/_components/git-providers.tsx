"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { Input } from "@bob/ui/input";
import { Label } from "@bob/ui/label";

import { useTRPC } from "~/trpc/react";

export function GitProvidersSection() {
  const trpc = useTRPC();
  const { data: health } = useQuery(
    trpc.gitProviders.checkHealth.queryOptions(undefined),
  );

  const healthByProvider = new Map<string, any>(
    (health ?? []).map((h: any) => [h.provider, h]),
  );

  return (
    <div className="space-y-6">
      <GitHubConnection health={healthByProvider.get("github")} />
      <ForgeGraphConnection health={healthByProvider.get("forgegraph")} />
    </div>
  );
}

// Surfaces whether a connector's credentials are still valid. Unhealthy
// connectors (expired/revoked tokens) prompt the user to reconnect.
function ConnectionHealthBadge({ health }: { health?: any }) {
  if (!health) return null;
  if (health.status === "healthy") {
    return <Badge variant="emerald">Healthy</Badge>;
  }
  return (
    <Badge variant="rose">
      {health.needsReauth ? "Reconnect needed" : "Unhealthy"}
    </Badge>
  );
}

function GitHubConnection({ health }: { health?: any }) {
  const trpc = useTRPC();
  const { data: connections, isLoading } = useQuery(
    trpc.gitProviders.listConnections.queryOptions(undefined),
  );

  const githubConnection = (connections ?? []).find(
    (c: any) => c.provider === "github",
  );

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="size-5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <div>
            <p className="text-sm font-medium">GitHub</p>
            <p className="text-xs text-muted-foreground">
              Connected via OAuth when you sign in
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {githubConnection && <ConnectionHealthBadge health={health} />}
          <Badge variant={githubConnection ? "default" : "slate"}>
            {isLoading ? "..." : githubConnection ? "Connected" : "Sign in to connect"}
          </Badge>
        </div>
      </div>
      {githubConnection && health?.status === "unhealthy" && (
        <p className="mt-2 text-xs text-destructive">
          {health.needsReauth
            ? "GitHub authorization has expired. Sign in again to restore access."
            : `Health check failed${health.error ? `: ${health.error}` : "."}`}
        </p>
      )}
    </div>
  );
}

function ForgeGraphConnection({ health }: { health?: any }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: connection, isLoading } = useQuery(
    trpc.settings.getForgeGraphConnection.queryOptions(undefined),
  );

  const connectMutation = useMutation(
    trpc.settings.connectForgeGraph.mutationOptions({
      onSuccess: () => {
        setToken("");
        setError(null);
        void queryClient.invalidateQueries({
          queryKey: trpc.settings.getForgeGraphConnection.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.gitProviders.checkHealth.queryKey(),
        });
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to connect");
      },
    }),
  );

  const disconnectMutation = useMutation(
    trpc.settings.disconnectForgeGraph.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.settings.getForgeGraphConnection.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.gitProviders.checkHealth.queryKey(),
        });
      },
    }),
  );

  // An unhealthy token that needs re-auth can't be repaired by refreshing — the
  // user must supply a fresh token, so surface the connect form even while a
  // (stale) connection record exists.
  const needsReauth =
    health?.status === "unhealthy" && Boolean(health?.needsReauth);
  const showTokenForm = !connection || needsReauth;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <svg className="size-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <div>
            <p className="text-sm font-medium">ForgeGraph</p>
            <p className="text-xs text-muted-foreground">
              forgegraph.com — deployment pipeline integration
            </p>
          </div>
        </div>
        {connection && (
          <div className="flex items-center gap-2">
            <ConnectionHealthBadge health={health} />
            <Badge variant="default">
              Connected{connection.providerUsername ? ` as ${connection.providerUsername}` : ""}
            </Badge>
          </div>
        )}
      </div>

      {connection && health?.status === "unhealthy" && (
        <p className="mb-3 text-xs text-destructive">
          {health.needsReauth
            ? "Your ForgeGraph API token is no longer valid. Reconnect with a new token below."
            : `Health check failed${health.error ? `: ${health.error}` : "."}`}
        </p>
      )}

      {connection && !showTokenForm ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Connected since {new Date(connection.createdAt).toLocaleDateString()}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnectMutation.mutate(undefined)}
            disabled={disconnectMutation.isPending}
          >
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label htmlFor="fg-token" className="text-xs">API Token</Label>
            <Input
              id="fg-token"
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); setError(null); }}
              placeholder="Enter your ForgeGraph API token"
              className="mt-1"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <Button
            size="sm"
            onClick={() => connectMutation.mutate({ apiToken: token })}
            disabled={!token || connectMutation.isPending}
          >
            {connectMutation.isPending
              ? needsReauth
                ? "Reconnecting..."
                : "Connecting..."
              : needsReauth
                ? "Reconnect"
                : "Connect"}
          </Button>
        </div>
      )}
    </div>
  );
}

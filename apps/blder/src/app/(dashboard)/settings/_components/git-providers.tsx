"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { Input } from "@bob/ui/input";
import { Label } from "@bob/ui/label";

import { useTRPC } from "~/trpc/react";

export function GitProvidersSection() {
  return (
    <div className="space-y-6">
      <GitHubConnection />
      <ForgeGraphConnection />
    </div>
  );
}

function GitHubConnection() {
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
        <Badge variant={githubConnection ? "default" : "secondary"}>
          {isLoading ? "..." : githubConnection ? "Connected" : "Sign in to connect"}
        </Badge>
      </div>
    </div>
  );
}

function ForgeGraphConnection() {
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
      },
    }),
  );

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
              forgegraf.com — deployment pipeline integration
            </p>
          </div>
        </div>
        {connection && (
          <Badge variant="default">
            Connected{connection.providerUsername ? ` as ${connection.providerUsername}` : ""}
          </Badge>
        )}
      </div>

      {connection ? (
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
            {connectMutation.isPending ? "Connecting..." : "Connect"}
          </Button>
        </div>
      )}
    </div>
  );
}

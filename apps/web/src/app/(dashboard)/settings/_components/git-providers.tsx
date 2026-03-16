"use client";

import { useState, useTransition } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@bob/ui/button";
import { Input } from "@bob/ui/input";
import { Label } from "@bob/ui/label";

import { useTRPC } from "~/trpc/react";

type Provider = "gitea";

export function GitProvidersSection() {
  const [isPending, startTransition] = useTransition();
  const [provider, setProvider] = useState<Provider>("gitea");
  const [instanceUrl, setInstanceUrl] = useState("https://git.gmac.io");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: connections, isLoading } = useQuery(
    trpc.gitProviders.listConnections.queryOptions(undefined),
  );

  const connectPat = useMutation(
    trpc.gitProviders.connectPat.mutationOptions({
      onSuccess: () => {
        setToken("");
        setError(null);
        void queryClient.invalidateQueries({
          queryKey: trpc.gitProviders.listConnections.queryKey(),
        });
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to connect provider");
      },
    }),
  );

  const disconnect = useMutation(
    trpc.gitProviders.disconnect.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.gitProviders.listConnections.queryKey(),
        });
      },
    }),
  );

  const handleConnect = () => {
    setError(null);
    if (!token.trim()) return;

    startTransition(() => {
      connectPat.mutate({
        provider,
        accessToken: token.trim(),
        instanceUrl: provider === "gitea" ? instanceUrl.trim() : undefined,
      });
    });
  };

  const handleDisconnect = (connectionId: string) => {
    if (!confirm("Disconnect this provider connection?")) return;
    startTransition(() => disconnect.mutate({ connectionId }));
  };

  return (
    <section className="rounded-lg border p-6">
      <h2 className="mb-4 text-xl font-semibold">Git Providers</h2>

      <div className="mb-6 grid gap-4">
        <div>
          <Label className="mb-2 block">Provider</Label>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => setProvider("gitea")}
              disabled={isPending}
            >
              Gitea
            </Button>
            <span className="text-sm text-gray-600">
              GitHub is connected via OAuth when you sign in.
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="giteaInstance" className="mb-2 block">
            Instance URL
          </Label>
          <Input
            id="giteaInstance"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            placeholder="https://git.gmac.io"
            className="max-w-lg"
          />
        </div>

        <div>
          <Label htmlFor="patToken" className="mb-2 block">
            Personal Access Token
          </Label>
          <Input
            id="patToken"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Gitea token"
            className="max-w-lg"
          />
          <p className="mt-2 text-sm text-gray-600">
            Stored encrypted server-side; used to list and clone repositories.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handleConnect}
            disabled={
              isPending ||
              connectPat.isPending ||
              !token.trim() ||
              !instanceUrl.trim()
            }
          >
            Connect
          </Button>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-medium">Connected</h3>
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="bg-muted h-12 rounded" />
            <div className="bg-muted h-12 rounded" />
          </div>
        ) : connections?.length ? (
          <div className="space-y-3">
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <div className="font-medium">
                    {c.provider.toUpperCase()}
                    {c.instanceUrl ? (
                      <span className="ml-2 text-sm font-normal text-gray-600">
                        {c.instanceUrl}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-gray-600">
                    {c.providerUsername ? `@${c.providerUsername}` : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDisconnect(c.id)}
                  disabled={isPending || disconnect.isPending}
                >
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No providers connected yet.</p>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@gmacko/core/ui/button";
import { Input } from "@gmacko/core/ui/input";
import { Label } from "@gmacko/core/ui/label";

import { useBobRpcClient } from "~/rpc/react";

type WebhookConfig = {
  id: string;
  url: string;
  active: boolean;
  description?: string | null;
  createdAt: Date | string;
};

function generateSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  for (const byte of array) {
    result += chars[byte % chars.length];
  }
  return result;
}

export function WebhooksSection() {
  const [isPending, startTransition] = useTransition();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newSecret, setNewSecret] = useState(() => generateSecret());
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rpc = useBobRpcClient();
  const queryClient = useQueryClient();
  const { data: webhooks, isLoading } = useQuery({
    queryKey: ["rpc", "external.webhook.list"],
    queryFn: async () =>
      (await rpc.external.webhook.list({})) as WebhookConfig[],
  });

  const createWebhook = useMutation({
    mutationFn: (input: {
      url: string;
      secret: string;
      description?: string;
      active: boolean;
    }) => rpc.external.webhook.create(input),
    onSuccess: () => {
      setShowCreateForm(false);
      setNewUrl("");
      setNewSecret(generateSecret());
      setNewDescription("");
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: ["rpc", "external.webhook.list"],
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create webhook");
    },
  });

  const deleteWebhook = useMutation({
    mutationFn: (input: { id: string }) => rpc.external.webhook.delete(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["rpc", "external.webhook.list"],
      });
    },
  });

  const handleCreate = () => {
    if (!newUrl.trim() || newSecret.length < 16) return;

    startTransition(() => {
      createWebhook.mutate({
        url: newUrl,
        secret: newSecret,
        description: newDescription || undefined,
        active: true,
      });
    });
  };

  const handleDelete = (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this webhook? This cannot be undone.",
      )
    ) {
      return;
    }

    startTransition(() => {
      deleteWebhook.mutate({ id });
    });
  };

  if (isLoading) {
    return (
      <section className="rounded-lg border p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">Webhooks</h2>
        <div className="animate-pulse space-y-4">
          <div className="bg-muted h-16 rounded" />
          <div className="bg-muted h-16 rounded" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Webhooks</h2>
        {!showCreateForm && (
          <Button onClick={() => setShowCreateForm(true)} size="sm">
            Add Webhook
          </Button>
        )}
      </div>

      {showCreateForm && (
        <div className="mb-6 rounded-lg border p-4">
          <h3 className="mb-4 font-medium">New Webhook</h3>

          {error && (
            <p className="text-destructive mb-4 text-sm">{error}</p>
          )}

          <div className="mb-4">
            <Label htmlFor="webhookUrl" className="mb-2 block">
              Payload URL
            </Label>
            <Input
              id="webhookUrl"
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="max-w-lg"
            />
          </div>

          <div className="mb-4">
            <Label htmlFor="webhookSecret" className="mb-2 block">
              Secret
            </Label>
            <Input
              id="webhookSecret"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              className="max-w-lg font-mono text-sm"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Used to sign webhook payloads. Minimum 16 characters.
            </p>
          </div>

          <div className="mb-4">
            <Label htmlFor="webhookDescription" className="mb-2 block">
              Description (optional)
            </Label>
            <Input
              id="webhookDescription"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Production notification endpoint"
              className="max-w-lg"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleCreate}
              disabled={isPending || !newUrl.trim() || newSecret.length < 16}
            >
              Create Webhook
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateForm(false);
                setNewUrl("");
                setNewSecret(generateSecret());
                setNewDescription("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {webhooks?.length === 0 ? (
          <p className="text-muted-foreground">No webhooks configured yet.</p>
        ) : (
          webhooks?.map((webhook) => (
            <div
              key={webhook.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      webhook.active ? "bg-green-500" : "bg-neutral-400"
                    }`}
                  />
                  <p className="truncate font-mono text-sm">{webhook.url}</p>
                </div>
                <div className="text-muted-foreground mt-1 flex items-center gap-4 text-sm">
                  <span>{webhook.active ? "Active" : "Inactive"}</span>
                  {webhook.description && (
                    <span className="truncate">{webhook.description}</span>
                  )}
                  <span>
                    Created: {new Date(webhook.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(webhook.id)}
                disabled={isPending}
              >
                Delete
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

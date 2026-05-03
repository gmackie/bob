"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";
import { Input } from "@gmacko/core/ui/input";
import { Label } from "@gmacko/core/ui/label";

import { useTRPC } from "~/trpc/react";

export function IntegrationsSection() {
  const trpc = useTRPC();
  const { data: workspaceMemberships, isLoading } = useQuery(
    trpc.workspace.list.queryOptions(undefined),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);

  const currentWorkspace = workspaces[0] as
    | { id: string; name: string }
    | undefined;

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading integrations...</p>
    );
  }

  if (!currentWorkspace) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a workspace first to configure integrations.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <LinearIntegration workspaceId={currentWorkspace.id} />
    </div>
  );
}

function LinearIntegration({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [apiKey, setApiKey] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamIdTouched, setTeamIdTouched] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const { data: integration, isLoading } = useQuery(
    trpc.integration.get.queryOptions(
      { workspaceId, provider: "linear" },
      { staleTime: 30_000 },
    ),
  );

  const saveMutation = useMutation(
    trpc.integration.save.mutationOptions({
      onSuccess: () => {
        setApiKey("");
        setWebhookSecret("");
        setTeamId("");
        setTeamIdTouched(false);
        setError(null);
        setEditing(false);
        void queryClient.invalidateQueries({
          queryKey: trpc.integration.get.queryKey({ workspaceId, provider: "linear" }),
        });
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to save");
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.integration.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.integration.get.queryKey({ workspaceId, provider: "linear" }),
        });
      },
    }),
  );

  const connected = integration && integration.enabled;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="size-5" viewBox="0 0 100 100" fill="none">
            <path
              d="M1.22541 61.5228c-.97834-2.1275-.6684-4.6014 .79646-6.4118l14.2131-17.5668c1.0283-1.2714 2.4662-2.1398 4.05-2.4483l21.7972-4.2464c1.6712-.3256 3.402.0642 4.7827 1.0772l17.4559 12.8136c1.1966.879 2.0455 2.1487 2.3998 3.5889l4.4927 18.2645c.4247 1.7264.084 3.5503-.9367 5.0174l-12.235 17.5814c-1.0759 1.5473-2.7652 2.5351-4.6216 2.7044l-22.3457 2.0362c-1.4624.1334-2.9281-.265-4.1235-1.1224L5.39503 75.4388c-1.98727-1.4239-3.19128-3.7885-3.19128-6.2712v-.0009"
              fill="currentColor"
            />
          </svg>
          <div>
            <p className="text-sm font-medium">Linear</p>
            <p className="text-xs text-muted-foreground">
              Project management — sync tasks and auto-dispatch agent work
            </p>
          </div>
        </div>
        <Badge variant={connected ? "default" : "slate"}>
          {isLoading ? "..." : connected ? "Connected" : "Not connected"}
        </Badge>
      </div>

      {connected && !editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">API Key</span>
              <p className="mt-0.5 font-mono">
                {integration.hasApiKey ? "••••••••" : "Not set"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Team ID</span>
              <p className="mt-0.5 font-mono">
                {integration.linearTeamId ?? "Not set"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Webhook Secret</span>
              <p className="mt-0.5 font-mono">
                {integration.hasWebhookSecret ? "••••••••" : "Not set"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Webhook URL</span>
              <p className="mt-0.5 font-mono text-[10px] break-all">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/webhooks/linear`
                  : "/api/webhooks/linear"}
              </p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteMutation.mutate({ workspaceId, provider: "linear" })}
              disabled={deleteMutation.isPending}
              className="text-destructive hover:text-destructive"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label htmlFor="linear-api-key" className="text-xs">
              API Key
            </Label>
            <Input
              id="linear-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError(null);
              }}
              placeholder={
                integration?.hasApiKey
                  ? "Leave blank to keep current key"
                  : "lin_api_..."
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="linear-team-id" className="text-xs">
              Team ID
            </Label>
            <Input
              id="linear-team-id"
              value={teamIdTouched ? teamId : (editing ? integration?.linearTeamId ?? "" : teamId)}
              onChange={(e) => {
                setTeamId(e.target.value);
                setTeamIdTouched(true);
                setError(null);
              }}
              placeholder="UUID of your Linear team"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="linear-webhook-secret" className="text-xs">
              Webhook Signing Secret
            </Label>
            <Input
              id="linear-webhook-secret"
              type="password"
              value={webhookSecret}
              onChange={(e) => {
                setWebhookSecret(e.target.value);
                setError(null);
              }}
              placeholder={
                integration?.hasWebhookSecret
                  ? "Leave blank to keep current secret"
                  : "From Linear webhook settings"
              }
              className="mt-1"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Set the webhook URL in Linear to:{" "}
              <code className="rounded bg-muted px-1">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/webhooks/linear`
                  : "/api/webhooks/linear"}
              </code>
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const payload: Record<string, string> = {
                  workspaceId,
                  provider: "linear",
                };
                if (apiKey) payload.apiKey = apiKey;
                if (teamIdTouched) payload.linearTeamId = teamId;
                else if (teamId) payload.linearTeamId = teamId;
                if (webhookSecret) payload.webhookSigningSecret = webhookSecret;
                saveMutation.mutate(payload as any);
              }}
              disabled={
                saveMutation.isPending ||
                (!apiKey && !teamId && !webhookSecret && !editing)
              }
            >
              {saveMutation.isPending
                ? "Saving..."
                : connected
                  ? "Update"
                  : "Connect"}
            </Button>
            {editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                  setTeamId("");
                  setTeamIdTouched(false);
                  setWebhookSecret("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

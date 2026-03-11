"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Badge,
  Separator,
  Checkbox,
} from "@linear-clone/ui";
import {
  Webhook,
  Loader2,
  Plus,
  Check,
  AlertCircle,
  Trash2,
  Play,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Circle,
  ExternalLink,
} from "lucide-react";

interface WebhooksSettingsProps {
  workspaceId: string | null;
}

const WEBHOOK_EVENTS = [
  { id: "issue.created", label: "Issue created", description: "When a new issue is created" },
  { id: "issue.updated", label: "Issue updated", description: "When issue fields are changed" },
  { id: "issue.status_changed", label: "Status changed", description: "When issue status changes" },
  { id: "issue.completed", label: "Issue completed", description: "When an issue is marked done" },
  { id: "issue.deleted", label: "Issue deleted", description: "When an issue is deleted" },
  { id: "comment.created", label: "Comment created", description: "When a comment is added" },
] as const;

type WebhookEvent = typeof WEBHOOK_EVENTS[number]["id"];

export function WebhooksSettings({ workspaceId }: WebhooksSettingsProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeliveryLogs, setShowDeliveryLogs] = useState<string | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set(["issue.created", "issue.updated"]));
  const [showSecret, setShowSecret] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const { data: webhooks, isLoading: webhooksLoading, refetch: refetchWebhooks } = api.outboundWebhook.list.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId }
  );

  const createWebhook = api.outboundWebhook.create.useMutation({
    onSuccess: (data) => {
      setNewSecret(data.secret);
      refetchWebhooks();
      resetForm();
    },
  });

  const updateWebhook = api.outboundWebhook.update.useMutation({
    onSuccess: () => {
      refetchWebhooks();
      resetForm();
      setEditingWebhook(null);
    },
  });

  const deleteWebhook = api.outboundWebhook.delete.useMutation({
    onSuccess: () => {
      refetchWebhooks();
    },
  });

  const testWebhook = api.outboundWebhook.test.useMutation({
    onSuccess: () => {
      refetchWebhooks();
    },
  });

  const regenerateSecret = api.outboundWebhook.regenerateSecret.useMutation({
    onSuccess: (data) => {
      setNewSecret(data.secret);
      refetchWebhooks();
    },
  });

  const resetForm = () => {
    setName("");
    setUrl("");
    setSelectedEvents(new Set(["issue.created", "issue.updated"]));
    setShowCreateModal(false);
  };

  const handleCreate = () => {
    if (!workspaceId || !name.trim() || !url.trim()) return;

    createWebhook.mutate({
      workspaceId,
      name: name.trim(),
      url: url.trim(),
      events: Array.from(selectedEvents) as WebhookEvent[],
      enabled: true,
    });
  };

  const handleUpdate = () => {
    if (!editingWebhook) return;

    updateWebhook.mutate({
      id: editingWebhook,
      name: name.trim() || undefined,
      url: url.trim() || undefined,
      events: Array.from(selectedEvents) as WebhookEvent[],
    });
  };

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const startEdit = (webhook: typeof webhooks extends (infer T)[] | undefined ? NonNullable<T> : never) => {
    setEditingWebhook(webhook.id);
    setName(webhook.name);
    setUrl(webhook.url);
    setSelectedEvents(new Set((webhook.events as string[]) || []));
  };

  const copySecret = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  if (!workspaceId) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-500">No workspace selected</p>
              <p className="text-sm text-muted-foreground">
                Select a workspace in the Workspaces tab to configure webhooks.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {newSecret && (
        <Card className="border-green-500 bg-green-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <AlertCircle className="h-5 w-5" />
              Webhook Secret Generated
            </CardTitle>
            <CardDescription>
              Copy this secret now. You won&apos;t be able to see it again!
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted p-3 font-mono text-sm break-all">
                {showSecret ? newSecret : newSecret.substring(0, 8) + "..." + newSecret.slice(-4)}
              </code>
              <Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={() => copySecret(newSecret)}>
                {copiedSecret ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="ghost" className="mt-4" onClick={() => setNewSecret(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                Outbound Webhooks
              </CardTitle>
              <CardDescription>
                Send events to external services when issues are created, updated, or completed.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetchWebhooks()}>
                <RefreshCw className={`h-4 w-4 mr-2 ${webhooksLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New Webhook
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {webhooksLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : webhooks && webhooks.length > 0 ? (
            <div className="space-y-3">
              {webhooks.map((webhook) => (
                <WebhookItem
                  key={webhook.id}
                  webhook={webhook}
                  onEdit={() => startEdit(webhook)}
                  onDelete={() => {
                    if (confirm("Delete this webhook? This cannot be undone.")) {
                      deleteWebhook.mutate({ id: webhook.id });
                    }
                  }}
                  onTest={() => testWebhook.mutate({ id: webhook.id })}
                  onToggle={() => {
                    updateWebhook.mutate({
                      id: webhook.id,
                      enabled: !webhook.enabled,
                    });
                  }}
                  onRegenerateSecret={() => regenerateSecret.mutate({ id: webhook.id })}
                  onShowLogs={() => setShowDeliveryLogs(showDeliveryLogs === webhook.id ? null : webhook.id)}
                  isExpanded={showDeliveryLogs === webhook.id}
                  isTesting={testWebhook.isPending && testWebhook.variables?.id === webhook.id}
                  isDeleting={deleteWebhook.isPending && deleteWebhook.variables?.id === webhook.id}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Webhook className="mx-auto h-12 w-12 opacity-50 mb-4" />
              <p>No webhooks configured</p>
              <p className="text-sm">Create a webhook to send events to external services</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Payload</CardTitle>
          <CardDescription>
            All webhooks receive a JSON payload with the following structure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Headers</p>
            <code className="block rounded bg-muted p-3 text-sm whitespace-pre">
{`Content-Type: application/json
User-Agent: LinearClone-Webhook/1.0
X-Webhook-Event: issue.created
X-Webhook-Delivery: <uuid>
X-Webhook-Timestamp: <iso-8601>
X-Webhook-Signature: sha256=<hmac-signature>`}
            </code>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Example Payload</p>
            <code className="block rounded bg-muted p-3 text-sm whitespace-pre overflow-x-auto">
{`{
  "event": "issue.created",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "workspace": {
    "id": "ws_123",
    "name": "My Workspace",
    "slug": "my-workspace"
  },
  "project": {
    "id": "proj_456",
    "name": "My Project",
    "key": "PROJ"
  },
  "issue": {
    "id": "issue_789",
    "identifier": "PROJ-42",
    "title": "Fix login bug",
    "status": "todo",
    "priority": "high",
    ...
  }
}`}
            </code>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Signature Verification</p>
            <code className="block rounded bg-muted p-3 text-sm whitespace-pre overflow-x-auto">
{`Verify the signature using your webhook secret
const crypto = require('crypto');

function verifySignature(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return signature === \`sha256=\${expected}\`;
}`}
            </code>
          </div>
        </CardContent>
      </Card>

      {(showCreateModal || editingWebhook) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>{editingWebhook ? "Edit Webhook" : "Create Webhook"}</CardTitle>
              <CardDescription>
                {editingWebhook
                  ? "Update webhook configuration."
                  : "Configure a new webhook to receive events."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="webhook-name">Name</Label>
                <Input
                  id="webhook-name"
                  placeholder="e.g., Habit Integration"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="webhook-url">URL</Label>
                <Input
                  id="webhook-url"
                  placeholder="https://your-app.com/webhooks/tasks"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <Separator />

              <div className="grid gap-2">
                <Label>Events</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Select which events will trigger this webhook.
                </p>
                <div className="space-y-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <div
                      key={event.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedEvents.has(event.id)
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleEvent(event.id)}
                    >
                      <Checkbox
                        checked={selectedEvents.has(event.id)}
                        onCheckedChange={() => toggleEvent(event.id)}
                      />
                      <div>
                        <p className="font-medium text-sm">{event.label}</p>
                        <p className="text-xs text-muted-foreground">{event.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
            <div className="flex justify-end gap-2 p-6 pt-0">
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setEditingWebhook(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={editingWebhook ? handleUpdate : handleCreate}
                disabled={
                  !name.trim() ||
                  !url.trim() ||
                  selectedEvents.size === 0 ||
                  createWebhook.isPending ||
                  updateWebhook.isPending
                }
              >
                {(createWebhook.isPending || updateWebhook.isPending) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : editingWebhook ? (
                  "Update Webhook"
                ) : (
                  "Create Webhook"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

interface WebhookItemProps {
  webhook: {
    id: string;
    name: string;
    url: string;
    events: unknown;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onToggle: () => void;
  onRegenerateSecret: () => void;
  onShowLogs: () => void;
  isExpanded: boolean;
  isTesting: boolean;
  isDeleting: boolean;
}

function WebhookItem({
  webhook,
  onEdit,
  onDelete,
  onTest,
  onToggle,
  onRegenerateSecret,
  onShowLogs,
  isExpanded,
  isTesting,
  isDeleting,
}: WebhookItemProps) {
  const events = webhook.events as string[];

  const { data: deliveries, isLoading: deliveriesLoading } = api.outboundWebhook.deliveries.useQuery(
    { webhookId: webhook.id, limit: 20 },
    { enabled: isExpanded }
  );

  return (
    <div className={`rounded-lg border ${webhook.enabled ? "border-border" : "border-muted bg-muted/30"}`}>
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              webhook.enabled ? "bg-primary/10" : "bg-muted"
            }`}
          >
            <Webhook className={`h-5 w-5 ${webhook.enabled ? "text-primary" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={`font-medium ${!webhook.enabled && "text-muted-foreground"}`}>
                {webhook.name}
              </p>
              {webhook.enabled ? (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/50 text-xs">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  Disabled
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate max-w-[300px]">{webhook.url}</p>
            <div className="flex items-center gap-2 mt-1">
              {events.map((event) => (
                <Badge key={event} variant="secondary" className="text-xs">
                  {event}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowLogs}
            className="text-muted-foreground"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Logs
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onTest}
            disabled={isTesting}
          >
            {isTesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
            {webhook.enabled ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <Circle className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t px-4 py-3 bg-muted/30">
          {deliveriesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : deliveries && deliveries.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Recent Deliveries</p>
                <Button variant="ghost" size="sm" onClick={onRegenerateSecret}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Regenerate Secret
                </Button>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {deliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    className={`flex items-center justify-between p-2 rounded text-sm ${
                      delivery.success ? "bg-green-500/5" : "bg-red-500/5"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {delivery.success ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {delivery.event}
                      </Badge>
                      {delivery.statusCode && (
                        <span className="text-muted-foreground">{delivery.statusCode}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      {delivery.durationMs && (
                        <span>{delivery.durationMs}ms</span>
                      )}
                      <Clock className="h-3 w-3" />
                      <span>
                        {new Date(delivery.deliveredAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No delivery logs yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

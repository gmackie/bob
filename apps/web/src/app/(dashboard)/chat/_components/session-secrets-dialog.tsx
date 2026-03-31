"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bob/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bob/ui/dialog";
import { Input } from "@bob/ui/input";
import { Label } from "@bob/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bob/ui/select";
import { Textarea } from "@bob/ui/textarea";
import { toast } from "@bob/ui/toast";

import { useTRPC } from "~/trpc/react";

const AVAILABLE_TEMPLATES = [
  {
    id: "gh-api",
    label: "GitHub API",
    description: "Pipes the secret into `gh api` as `GITHUB_TOKEN`.",
  },
  {
    id: "docker-login",
    label: "Docker Login",
    description: "Pipes the secret into `docker login --password-stdin`.",
  },
] as const;

const DEPLOY_ENVIRONMENTS = ["dev", "staging", "preview", "prod"] as const;

interface SessionSecretRecord {
  id: string;
  label: string;
  handle: string;
  provider: string;
  status: string;
  externalRef?: string | null;
  lastUsedAt?: string | Date | null;
  createdAt?: string | Date;
  policy?: {
    allowedTemplates?: string[];
  } | null;
}

interface PromotionDraft {
  environment: (typeof DEPLOY_ENVIRONMENTS)[number];
  forgegraphKey: string;
}

interface SessionSecretsDialogProps {
  sessionId: string;
  projectId?: string | null;
}

function normalizeHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function defaultForgeGraphKey(handle: string) {
  return handle.replace(/-/g, "_").toUpperCase();
}

function formatTimestamp(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function SessionSecretsDialog({
  sessionId,
  projectId,
}: SessionSecretsDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [handle, setHandle] = useState("");
  const [value, setValue] = useState("");
  const [allowedTemplates, setAllowedTemplates] = useState<string[]>(["gh-api"]);
  const [promotionDrafts, setPromotionDrafts] = useState<
    Record<string, PromotionDraft>
  >({});

  const secretsQuery = useQuery(
    trpc.secrets.listSessionSecrets.queryOptions(
      { sessionId },
      { enabled: open },
    ),
  );

  const invalidateSecrets = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.secrets.listSessionSecrets.queryKey({ sessionId }),
    });

  const createSecret = useMutation(
    trpc.secrets.createSessionSecret.mutationOptions({
      onSuccess: async () => {
        toast("Secret added to this session");
        setLabel("");
        setHandle("");
        setValue("");
        setAllowedTemplates(["gh-api"]);
        await invalidateSecrets();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const deleteSecret = useMutation(
    trpc.secrets.deleteSessionSecret.mutationOptions({
      onSuccess: async () => {
        toast("Secret removed");
        await invalidateSecrets();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const promoteSecret = useMutation(
    trpc.secrets.promoteSessionSecret.mutationOptions({
      onSuccess: async () => {
        toast("Secret promoted to ForgeGraph");
        await invalidateSecrets();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const secrets = (secretsQuery.data ?? []) as SessionSecretRecord[];

  const canCreate =
    label.trim().length > 0 &&
    handle.trim().length > 0 &&
    value.length > 0 &&
    allowedTemplates.length > 0;

  const sortedSecrets = useMemo(
    () =>
      [...secrets].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      }),
    [secrets],
  );

  function toggleTemplate(templateId: string) {
    setAllowedTemplates((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  }

  function getPromotionDraft(secret: SessionSecretRecord): PromotionDraft {
    return (
      promotionDrafts[secret.id] ?? {
        environment: "dev",
        forgegraphKey: defaultForgeGraphKey(secret.handle),
      }
    );
  }

  function updatePromotionDraft(
    secretId: string,
    patch: Partial<PromotionDraft>,
    fallbackHandle: string,
  ) {
    setPromotionDrafts((current) => {
      const existing =
        current[secretId] ?? {
          environment: "dev",
          forgegraphKey: defaultForgeGraphKey(fallbackHandle),
        };
      return {
        ...current,
        [secretId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  function handleCreateSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;

    createSecret.mutate({
      sessionId,
      label: label.trim(),
      handle: handle.trim(),
      value,
      transport: "template",
      policy: {
        allowedTemplates,
        redactOutput: true,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="chat-headerAction">
          Secrets
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Session secrets</DialogTitle>
          <DialogDescription>
            Paste a secret once, bind it to approved execution templates, and keep
            the plaintext out of the transcript. Bob can use it, but the session UI
            never shows the raw value again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <form className="space-y-4" onSubmit={handleCreateSecret}>
            <div className="space-y-2">
              <Label htmlFor="session-secret-label">Label</Label>
              <Input
                id="session-secret-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="GitHub PAT"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="session-secret-handle">Handle</Label>
              <Input
                id="session-secret-handle"
                value={handle}
                onChange={(event) => setHandle(normalizeHandle(event.target.value))}
                placeholder="github-pat"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="text-xs text-muted-foreground">
                Agents reference the secret by handle. The value itself stays write-only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="session-secret-value">Secret value</Label>
              <Textarea
                id="session-secret-value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Paste the secret here"
                className="min-h-28 font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label>Allowed execution templates</Label>
              <div className="space-y-2">
                {AVAILABLE_TEMPLATES.map((template) => {
                  const isSelected = allowedTemplates.includes(template.id);
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => toggleTemplate(template.id)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-foreground bg-accent/60 text-foreground"
                          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{template.label}</span>
                        <span className="text-xs uppercase tracking-[0.2em]">
                          {isSelected ? "Allowed" : "Blocked"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{template.description}</p>
                    </button>
                  );
                })}
              </div>
              {allowedTemplates.length === 0 && (
                <p className="text-xs text-rose-500">
                  Select at least one template or the secret cannot be used.
                </p>
              )}
            </div>

            <Button type="submit" disabled={!canCreate || createSecret.isPending}>
              {createSecret.isPending ? "Saving…" : "Add secret"}
            </Button>
          </form>

          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              {projectId
                ? "This session is linked to a project, so any secret can be promoted into the ForgeGraph stage store when you are ready."
                : "This session is not linked to a project yet, so promotion to ForgeGraph is unavailable. Session-scoped use still works."}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Agent-native path:
              </p>
              <code className="mt-2 block rounded-md bg-muted/30 px-3 py-2 text-xs text-foreground">
                exec_session_secret(handle=&quot;github-token&quot;, template=&quot;gh-api&quot;, args={"{"} path: &quot;/user&quot; {"}"})
              </code>
              <p className="mt-3 text-sm text-muted-foreground">
                Shell fallback:
              </p>
              <code className="mt-2 block rounded-md bg-muted/30 px-3 py-2 text-xs text-foreground">
                bob-session-secret exec --handle github-token --template gh-api --arg path=/user
              </code>
            </div>

            <div className="space-y-3">
              {secretsQuery.isLoading && (
                <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  Loading session secrets…
                </div>
              )}

              {!secretsQuery.isLoading && sortedSecrets.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No secrets added to this session yet.
                </div>
              )}

              {sortedSecrets.map((secret) => {
                const promotionDraft = getPromotionDraft(secret);
                const allowed = secret.policy?.allowedTemplates ?? [];
                const createdAt = formatTimestamp(secret.createdAt);
                const lastUsedAt = formatTimestamp(secret.lastUsedAt);

                return (
                  <div
                    key={secret.id}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-foreground">{secret.label}</h3>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                            {secret.status}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                            {secret.provider}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">
                          {secret.handle}
                        </p>
                        {allowed.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Allowed: {allowed.join(", ")}
                          </p>
                        )}
                        {createdAt && (
                          <p className="text-xs text-muted-foreground">
                            Added {createdAt}
                          </p>
                        )}
                        {lastUsedAt && (
                          <p className="text-xs text-muted-foreground">
                            Last used {lastUsedAt}
                          </p>
                        )}
                        {secret.externalRef && (
                          <p className="text-xs text-muted-foreground">
                            ForgeGraph ref: {secret.externalRef}
                          </p>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSecret.mutate({ secretId: secret.id })}
                        disabled={deleteSecret.isPending}
                      >
                        Delete
                      </Button>
                    </div>

                    {projectId && secret.provider !== "forgegraph" && (
                      <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                        <Select
                          value={promotionDraft.environment}
                          onValueChange={(environment) =>
                            updatePromotionDraft(
                              secret.id,
                              {
                                environment: environment as PromotionDraft["environment"],
                              },
                              secret.handle,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEPLOY_ENVIRONMENTS.map((environment) => (
                              <SelectItem key={environment} value={environment}>
                                {environment}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          value={promotionDraft.forgegraphKey}
                          onChange={(event) =>
                            updatePromotionDraft(
                              secret.id,
                              { forgegraphKey: event.target.value.toUpperCase() },
                              secret.handle,
                            )
                          }
                          placeholder="FORGEGRAPH_KEY"
                        />

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            promoteSecret.mutate({
                              secretId: secret.id,
                              projectId,
                              environment: promotionDraft.environment,
                              forgegraphKey: promotionDraft.forgegraphKey.trim(),
                            })
                          }
                          disabled={
                            promoteSecret.isPending ||
                            promotionDraft.forgegraphKey.trim().length === 0
                          }
                        >
                          Promote
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

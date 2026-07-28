"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";
import { Input } from "@gmacko/core/ui/input";
import { Label } from "@gmacko/core/ui/label";
import { Textarea } from "@gmacko/core/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gmacko/core/ui/select";
import { toast } from "@gmacko/core/ui/toast";

import { useBobRpcClient } from "~/rpc/react";
import { getWorktreeProviders, getProviderLabel } from "~/lib/providers";

// Mirror of the AgentPersonaSchema wire shape (contract in
// @gmacko/core/contracts/schemas/agent-persona). Kept local so the section
// doesn't pull the Effect Schema types into the client bundle.
interface Persona {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  adapterId: string;
  model: string | null;
  systemPrompt: string | null;
  allowedTools: string[] | null;
  autonomyLevel: string | null;
  budgetLimitCents: number | null;
  source: "repo" | "ui";
  active: boolean;
}

const AUTONOMY_LEVELS = [
  "observe",
  "recommend",
  "draft",
  "safe_execute",
  "full_execute",
] as const;

const PROVIDERS = getWorktreeProviders();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface PersonaFormState {
  name: string;
  description: string;
  adapterId: string;
  model: string;
  systemPrompt: string;
  autonomyLevel: string;
  budgetLimitDollars: string;
  allowedTools: string;
}

function emptyForm(): PersonaFormState {
  return {
    name: "",
    description: "",
    adapterId: PROVIDERS[0]?.id ?? "claude",
    model: "",
    systemPrompt: "",
    autonomyLevel: "recommend",
    budgetLimitDollars: "",
    allowedTools: "",
  };
}

function formFromPersona(p: Persona): PersonaFormState {
  return {
    name: p.name,
    description: p.description ?? "",
    adapterId: p.adapterId,
    model: p.model ?? "",
    systemPrompt: p.systemPrompt ?? "",
    autonomyLevel: p.autonomyLevel ?? "recommend",
    budgetLimitDollars:
      p.budgetLimitCents != null ? String(p.budgetLimitCents / 100) : "",
    allowedTools: (p.allowedTools ?? []).join(", "),
  };
}

// Shared create/edit payload builder — omits empty optionals.
function buildPayload(form: PersonaFormState) {
  const tools = form.allowedTools
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const dollars = parseFloat(form.budgetLimitDollars);
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    adapterId: form.adapterId,
    model: form.model.trim() || undefined,
    systemPrompt: form.systemPrompt.trim() || undefined,
    allowedTools: tools.length > 0 ? tools : undefined,
    autonomyLevel: form.autonomyLevel || undefined,
    budgetLimitCents: Number.isFinite(dollars)
      ? Math.round(dollars * 100)
      : undefined,
  };
}

function PersonaForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: PersonaFormState;
  submitLabel: string;
  pending: boolean;
  onSubmit: (form: PersonaFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PersonaFormState>(initial);
  const set = <K extends keyof PersonaFormState>(
    key: K,
    value: PersonaFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Careful Reviewer"
          />
          {form.name ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              slug: {slugify(form.name)}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Adapter</Label>
          <Select value={form.adapterId} onValueChange={(v) => set("adapterId", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.icon} {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Model <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="adapter default"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Autonomy</Label>
          <Select
            value={form.autonomyLevel}
            onValueChange={(v) => set("autonomyLevel", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTONOMY_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>
            Budget cap <span className="text-muted-foreground">(USD, optional)</span>
          </Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.budgetLimitDollars}
            onChange={(e) => set("budgetLimitDollars", e.target.value)}
            placeholder="no cap"
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Allowed tools <span className="text-muted-foreground">(comma-separated, optional)</span>
          </Label>
          <Input
            value={form.allowedTools}
            onChange={(e) => set("allowedTools", e.target.value)}
            placeholder="all tools"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
        <Input
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="one-line summary"
        />
      </div>
      <div className="space-y-1.5">
        <Label>System prompt <span className="text-muted-foreground">(optional)</span></Label>
        <Textarea
          rows={5}
          value={form.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)}
          placeholder="Extra instructions prepended to every run with this persona…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSubmit(form)}
          disabled={pending || !form.name.trim()}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}

function PersonaCard({
  persona,
  onEdit,
  onDelete,
  deleting,
}: {
  persona: Persona;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const readOnly = persona.source === "repo";
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{persona.name}</p>
          <Badge variant="slate">{getProviderLabel(persona.adapterId)}</Badge>
          {persona.model ? (
            <span className="font-mono text-xs text-muted-foreground">
              {persona.model}
            </span>
          ) : null}
          {readOnly ? <Badge variant="amber">repo</Badge> : null}
          {!persona.active ? <Badge variant="rose">inactive</Badge> : null}
        </div>
        {persona.description ? (
          <p className="text-sm text-muted-foreground">{persona.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {(persona.autonomyLevel ?? "recommend").replace(/_/g, " ")}
          {persona.budgetLimitCents != null
            ? ` · $${(persona.budgetLimitCents / 100).toFixed(2)} cap`
            : ""}
          {persona.allowedTools?.length
            ? ` · ${persona.allowedTools.length} tools`
            : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          disabled={readOnly}
          title={readOnly ? "Repo-sourced personas are read-only" : undefined}
        >
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={readOnly || deleting}
          className="text-destructive hover:text-destructive"
        >
          {deleting ? "…" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

export function PersonasSection() {
  const rpc = useBobRpcClient();
  const queryClient = useQueryClient();
  const queryKey = ["rpc", "agent.persona.list"] as const;

  const [mode, setMode] = useState<
    { kind: "list" } | { kind: "create" } | { kind: "edit"; persona: Persona }
  >({ kind: "list" });

  const { data: personas, isLoading } = useQuery({
    queryKey,
    queryFn: () => rpc.agent.persona.list({}) as Promise<Persona[]>,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
    setMode({ kind: "list" });
  };
  const onError = (err: Error) =>
    toast(err.message, {
      style: { background: "#1a0000", borderColor: "#f43f5e40" },
    });

  const createMutation = useMutation({
    mutationFn: (form: PersonaFormState) =>
      rpc.agent.persona.create({
        ...buildPayload(form),
        slug: slugify(form.name),
      }),
    onSuccess: invalidate,
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: PersonaFormState }) =>
      rpc.agent.persona.update({ id, ...buildPayload(form) }),
    onSuccess: invalidate,
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.agent.persona.delete({ id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading personas…</p>;
  }

  if (mode.kind === "create") {
    return (
      <PersonaForm
        initial={emptyForm()}
        submitLabel="Create persona"
        pending={createMutation.isPending}
        onSubmit={(form) => createMutation.mutate(form)}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "edit") {
    return (
      <PersonaForm
        initial={formFromPersona(mode.persona)}
        submitLabel="Save changes"
        pending={updateMutation.isPending}
        onSubmit={(form) =>
          updateMutation.mutate({ id: mode.persona.id, form })
        }
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  const rows = personas ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Named presets — an adapter + model + tools + prompt an agent run can
          adopt. Repo-sourced personas are read-only.
        </p>
        <Button size="sm" onClick={() => setMode({ kind: "create" })}>
          New persona
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          No personas yet. Create one to reuse an agent configuration across runs.
        </p>
      ) : (
        rows.map((persona) => (
          <PersonaCard
            key={persona.id}
            persona={persona}
            deleting={
              deleteMutation.isPending &&
              deleteMutation.variables === persona.id
            }
            onEdit={() => setMode({ kind: "edit", persona })}
            onDelete={() => {
              if (confirm(`Delete persona "${persona.name}"?`)) {
                deleteMutation.mutate(persona.id);
              }
            }}
          />
        ))
      )}
    </div>
  );
}

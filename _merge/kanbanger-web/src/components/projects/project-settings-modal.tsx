"use client";

import { useState } from "react";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import { Label } from "@linear-clone/ui/components/label";
import { Tabs, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { cn } from "@linear-clone/ui/lib/utils";
import { api } from "@/lib/trpc/client";
import {
  X,
  Loader2,
  Github,
  Webhook,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Switch } from "@linear-clone/ui/components/switch";

const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#ec4899",
];

type SettingsTab = "general" | "integrations";

interface ProjectSettingsModalProps {
  project: {
    id: string;
    name: string;
    key: string;
    color?: string | null;
    description?: string | null;
    issueSyncEnabled?: boolean;
    issueSyncDirection?: string | null;
    repositoryProvider?: string | null;
    repositoryFullName?: string | null;
    forgeRepositoryId?: string | null;
    bobLaunchPolicy?: "auto_or_manual" | "manual_only" | null;
    bobAwaitingInputTimeoutMinutes?: number | null;
  };
  workspaceId: string;
  onClose: () => void;
  onSubmit: (data: {
    name?: string;
    key?: string;
    color?: string;
    description?: string | null;
    issueSyncEnabled?: boolean;
    issueSyncDirection?: "outbound_only" | "inbound_only" | "bidirectional";
    forgeRepositoryId?: string | null;
    createForgeRepository?: boolean;
    forgeRepositoryName?: string;
    forgeRepositoryStorageBackend?: "s3" | "rsync";
    forgeRepositoryStoragePrefix?: string;
    bobLaunchPolicy?: "auto_or_manual" | "manual_only" | null;
    bobAwaitingInputTimeoutMinutes?: number | null;
  }) => Promise<void>;
  onDelete?: () => void;
}

export function ProjectSettingsModal({
  project,
  workspaceId,
  onClose,
  onSubmit,
  onDelete,
}: ProjectSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [name, setName] = useState(project.name);
  const [key, setKey] = useState(project.key);
  const [color, setColor] = useState(project.color ?? "#6366f1");
  const [description, setDescription] = useState(project.description ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [issueSyncEnabled, setIssueSyncEnabled] = useState(project.issueSyncEnabled ?? false);
  const [issueSyncDirection, setIssueSyncDirection] = useState<"outbound_only" | "inbound_only" | "bidirectional">(
    (project.issueSyncDirection as "outbound_only" | "inbound_only" | "bidirectional") ?? "bidirectional"
  );
  const [forgeRepositoryId, setForgeRepositoryId] = useState<string | null>(project.forgeRepositoryId ?? null);
  const [createForgeRepositoryMode, setCreateForgeRepositoryMode] = useState(false);
  const [createForgeRepositoryName, setCreateForgeRepositoryName] = useState("");
  const [createForgeRepositoryStorageBackend, setCreateForgeRepositoryStorageBackend] =
    useState<"s3" | "rsync">("s3");
  const [createForgeRepositoryStoragePrefix, setCreateForgeRepositoryStoragePrefix] = useState("");
  const [bobLaunchPolicy, setBobLaunchPolicy] = useState<"auto_or_manual" | "manual_only">(
    project.bobLaunchPolicy ?? "auto_or_manual"
  );
  const [bobAwaitingInputTimeoutMinutes, setBobAwaitingInputTimeoutMinutes] = useState(
    String(project.bobAwaitingInputTimeoutMinutes ?? 30)
  );

  const utils = api.useUtils();

  const { data: projectRepos, isLoading: reposLoading } =
    api.integration.getProjectRepositories.useQuery({ projectId: project.id });

  const { data: githubData } = api.integration.getGitHubRepos.useQuery();
  const { data: giteaData } = api.integration.getGiteaRepos.useQuery();
  const { data: forgeRepositories, isLoading: forgeReposLoading } = api.forgeRepository.list.useQuery({
    workspaceId,
  });

  const addRepoMutation = api.integration.addProjectRepository.useMutation({
    onSuccess: () => {
      utils.integration.getProjectRepositories.invalidate({ projectId: project.id });
      setShowAddRepo(false);
    },
  });

  const removeRepoMutation = api.integration.removeProjectRepository.useMutation({
    onSuccess: () => {
      utils.integration.getProjectRepositories.invalidate({ projectId: project.id });
    },
  });

  const setupWebhookMutation = api.integration.setupProjectRepoWebhook.useMutation({
    onSuccess: () => {
      utils.integration.getProjectRepositories.invalidate({ projectId: project.id });
    },
  });

  const validateKey = (value: string) => {
    if (value.length < 2) return "Key must be at least 2 characters";
    if (value.length > 10) return "Key must be at most 10 characters";
    if (!/^[A-Z][A-Z0-9]*$/.test(value)) return "Key must be uppercase alphanumeric, starting with a letter";
    return "";
  };

  const handleKeyChange = (value: string) => {
    const formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    setKey(formatted);
    setKeyError(validateKey(formatted));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const error = validateKey(key);
    if (error) {
      setKeyError(error);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim() !== project.name ? name.trim() : undefined,
        key: key !== project.key ? key : undefined,
        color: color !== project.color ? color : undefined,
        description: description.trim() !== (project.description ?? "")
          ? (description.trim() || null)
          : undefined,
        issueSyncEnabled: issueSyncEnabled !== (project.issueSyncEnabled ?? false) ? issueSyncEnabled : undefined,
        issueSyncDirection: issueSyncDirection !== (project.issueSyncDirection ?? "bidirectional") ? issueSyncDirection : undefined,
        forgeRepositoryId: createForgeRepositoryMode
          ? undefined
          : forgeRepositoryId !== (project.forgeRepositoryId ?? null)
            ? forgeRepositoryId
            : undefined,
        createForgeRepository: createForgeRepositoryMode
          ? true
          : undefined,
        forgeRepositoryName: createForgeRepositoryMode
          ? createForgeRepositoryName.trim() || undefined
          : undefined,
        forgeRepositoryStorageBackend: createForgeRepositoryMode
          ? createForgeRepositoryStorageBackend
          : undefined,
        forgeRepositoryStoragePrefix: createForgeRepositoryMode
          ? createForgeRepositoryStoragePrefix.trim() || undefined
          : undefined,
        bobLaunchPolicy:
          bobLaunchPolicy !== (project.bobLaunchPolicy ?? "auto_or_manual")
            ? bobLaunchPolicy
            : undefined,
        bobAwaitingInputTimeoutMinutes:
          Number(bobAwaitingInputTimeoutMinutes) !== (project.bobAwaitingInputTimeoutMinutes ?? 30)
            ? Number(bobAwaitingInputTimeoutMinutes)
            : undefined,
      });
      onClose();
    } catch (error) {
      console.error("Failed to update project:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasForgeChanges = createForgeRepositoryMode
    ? true
    : forgeRepositoryId !== (project.forgeRepositoryId ?? null);

  const hasChanges =
    name.trim() !== project.name ||
    key !== project.key ||
    color !== (project.color ?? "#6366f1") ||
    description.trim() !== (project.description ?? "") ||
    issueSyncEnabled !== (project.issueSyncEnabled ?? false) ||
    issueSyncDirection !== (project.issueSyncDirection ?? "bidirectional") ||
    bobLaunchPolicy !== (project.bobLaunchPolicy ?? "auto_or_manual") ||
    Number(bobAwaitingInputTimeoutMinutes) !== (project.bobAwaitingInputTimeoutMinutes ?? 30) ||
    hasForgeChanges;

  const linkedRepoIds = new Set(projectRepos?.map((r) => r.externalId) ?? []);

  const availableRepos = [
    ...(githubData?.repos ?? []).map((r) => ({ ...r, provider: "github" as const })),
    ...(giteaData?.repos ?? []).map((r) => ({ ...r, provider: "gitea" as const })),
  ].filter((r) => !linkedRepoIds.has(r.id));

  const currentForgeRepository = forgeRepositories?.find((r) => r.id === forgeRepositoryId);

  const handleAddRepo = (repo: {
    provider: "github" | "gitea";
    id: string;
    fullName: string;
    url: string;
    defaultBranch: string;
  }) => {
    addRepoMutation.mutate({
      projectId: project.id,
      provider: repo.provider,
      externalId: repo.id,
      fullName: repo.fullName,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      setupWebhook: true,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">Project Settings</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SettingsTab)}>
          <div className="border-b border-border px-4">
            <TabsList className="h-10">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
            </TabsList>
          </div>

          {activeTab === "general" && (
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 p-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Project name"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="key">
                    Short Key
                    <span className="ml-2 text-xs text-muted-foreground">
                      (used in task IDs like {key}-1)
                    </span>
                  </Label>
                  <Input
                    id="key"
                    type="text"
                    value={key}
                    onChange={(e) => handleKeyChange(e.target.value)}
                    placeholder="e.g., PROJ"
                    maxLength={10}
                    className={keyError ? "border-red-500" : ""}
                  />
                  {keyError && <p className="text-xs text-red-500">{keyError}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="grid grid-cols-6 gap-2">
                    {PROJECT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={cn(
                          "h-8 w-8 rounded-md transition-transform hover:scale-110",
                          color === c && "ring-2 ring-primary ring-offset-2"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this project about?"
                    className="min-h-[80px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
                  />
                </div>

                {onDelete && (
                  <div className="mt-6 pt-4 border-t border-destructive/20">
                    <h4 className="text-sm font-medium text-destructive mb-2">Danger Zone</h4>
                    {!showDeleteConfirm ? (
                      <div className="flex items-center justify-between p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                        <div>
                          <p className="text-sm font-medium">Delete this project</p>
                          <p className="text-xs text-muted-foreground">
                            This will permanently delete the project and all its tasks
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setShowDeleteConfirm(true)}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg border border-destructive bg-destructive/5 space-y-3">
                        <p className="text-sm">
                          Type <span className="font-mono font-bold">{project.name}</span> to confirm deletion:
                        </p>
                        <Input
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder={project.name}
                          className="border-destructive/50"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowDeleteConfirm(false);
                              setDeleteConfirmText("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deleteConfirmText !== project.name || isDeleting}
                            onClick={async () => {
                              setIsDeleting(true);
                              try {
                                onDelete();
                              } finally {
                                setIsDeleting(false);
                              }
                            }}
                          >
                            {isDeleting ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Deleting...
                              </>
                            ) : (
                              "Delete Project"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!name.trim() || !hasChanges || !!keyError || isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </form>
          )}

          {activeTab === "integrations" && (
            <div className="p-4 space-y-4">
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">Forge Repository</h3>
                    <p className="text-sm text-muted-foreground">
                      Link this project to a forge repo for jujutsu/CI workflows.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCreateForgeRepositoryMode((prev) => !prev)}
                    disabled={forgeReposLoading}
                  >
                    {createForgeRepositoryMode ? "Link existing" : "Create new"}
                  </Button>
                </div>

                {!createForgeRepositoryMode ? (
                  <div className="space-y-2">
                    <Label>Existing forge repository</Label>
                    {forgeReposLoading ? (
                      <p className="text-sm text-muted-foreground">Loading repositories...</p>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setForgeRepositoryId(null)}
                          className={cn(
                            "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                            forgeRepositoryId === null
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          None
                        </button>
                        {forgeRepositories?.map((repo) => (
                          <button
                            key={repo.id}
                            type="button"
                            onClick={() => setForgeRepositoryId(repo.id)}
                            className={cn(
                              "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                              forgeRepositoryId === repo.id
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:bg-muted"
                            )}
                          >
                            <span className="font-medium">{repo.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {repo.storageBackend} • {repo.storagePrefix}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="forgeRepositoryName">Name</Label>
                      <Input
                        id="forgeRepositoryName"
                        value={createForgeRepositoryName}
                        onChange={(e) => setCreateForgeRepositoryName(e.target.value)}
                        placeholder="forge-repo-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Storage backend</Label>
                      <div className="flex gap-2">
                        {(["s3", "rsync"] as const).map((backend) => (
                          <button
                            key={backend}
                            type="button"
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-sm",
                              createForgeRepositoryStorageBackend === backend
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:bg-muted"
                            )}
                            onClick={() => setCreateForgeRepositoryStorageBackend(backend)}
                          >
                            {backend.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="forgeRepositoryStoragePrefix">Storage prefix (optional)</Label>
                      <Input
                        id="forgeRepositoryStoragePrefix"
                        value={createForgeRepositoryStoragePrefix}
                        onChange={(e) => setCreateForgeRepositoryStoragePrefix(e.target.value)}
                        placeholder="workspace/project-id"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {currentForgeRepository
                        ? `Currently linked: ${currentForgeRepository.name}`
                        : "A new repository will be created and linked to this project."}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Linked Repositories</h3>
                  <p className="text-sm text-muted-foreground">
                    Repositories linked to this project for commit/PR tracking
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddRepo(!showAddRepo)}
                  disabled={availableRepos.length === 0}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {showAddRepo && availableRepos.length > 0 && (
                <div className="border rounded-lg p-3 bg-muted/30 space-y-2 max-h-48 overflow-y-auto">
                  <p className="text-xs text-muted-foreground mb-2">Select a repository to link:</p>
                  {availableRepos.map((repo) => (
                    <button
                      key={`${repo.provider}-${repo.id}`}
                      type="button"
                      onClick={() => handleAddRepo(repo)}
                      disabled={addRepoMutation.isPending}
                      className="flex items-center gap-2 w-full p-2 rounded hover:bg-muted text-left text-sm"
                    >
                      <div className={`flex h-6 w-6 items-center justify-center rounded ${
                        repo.provider === "github" ? "bg-[#24292e]" : "bg-[#609926]"
                      }`}>
                        {repo.provider === "github" ? (
                          <Github className="h-3 w-3 text-white" />
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="white">
                            <path d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.248 2.97 0 7.091-4.953 7.091-4.953s-.79-.085-1.91-.085c-1.12 0-1.654.428-2.482.428-.828 0-1.264-.31-1.264-.31s1.615-1.138 1.615-2.427c0-.73-.37-1.184-.37-1.184s1.002-.27 1.002-1.377c0-1.107-.83-1.685-.83-1.685s.705-1.018.705-1.92c0-.9-.7-1.6-.7-1.6s1.632-.35 1.632-2.185C13.31.647 11.942 0 10.834 0 9.726 0 4.456 4.603 4.209 4.603z" />
                          </svg>
                        )}
                      </div>
                      <span className="truncate flex-1">{repo.fullName}</span>
                    </button>
                  ))}
                </div>
              )}

              {reposLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : projectRepos && projectRepos.length > 0 ? (
                <div className="space-y-2">
                  {projectRepos.map((repo) => (
                    <div
                      key={repo.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          repo.provider === "github" ? "bg-[#24292e]" : "bg-[#609926]"
                        }`}>
                          {repo.provider === "github" ? (
                            <Github className="h-4 w-4 text-white" />
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="white">
                              <path d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.248 2.97 0 7.091-4.953 7.091-4.953s-.79-.085-1.91-.085c-1.12 0-1.654.428-2.482.428-.828 0-1.264-.31-1.264-.31s1.615-1.138 1.615-2.427c0-.73-.37-1.184-.37-1.184s1.002-.27 1.002-1.377c0-1.107-.83-1.685-.83-1.685s.705-1.018.705-1.92c0-.9-.7-1.6-.7-1.6s1.632-.35 1.632-2.185C13.31.647 11.942 0 10.834 0 9.726 0 4.456 4.603 4.209 4.603z" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{repo.fullName}</p>
                            {repo.url && (
                              <a
                                href={repo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="capitalize">{repo.provider}</span>
                            <span>•</span>
                            {repo.webhookConfigured ? (
                              <span className="flex items-center gap-1 text-green-600">
                                <Check className="h-3 w-3" />
                                Webhook active
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-yellow-600">
                                <AlertCircle className="h-3 w-3" />
                                No webhook
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!repo.webhookConfigured && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setupWebhookMutation.mutate({ repoId: repo.id })}
                            disabled={setupWebhookMutation.isPending}
                            title="Setup webhook"
                          >
                            <Webhook className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={() => {
                            if (confirm("Remove this repository from the project?")) {
                              removeRepoMutation.mutate({ id: repo.id });
                            }
                          }}
                          disabled={removeRepoMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Webhook className="mx-auto h-12 w-12 opacity-50 mb-4" />
                  <p>No repositories linked</p>
                  <p className="text-sm">
                    Link a GitHub or Gitea repository to enable commit and PR tracking
                  </p>
                </div>
              )}

              {!githubData?.connected && !giteaData?.connected && (
                <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-yellow-600">No integrations connected</p>
                      <p className="text-muted-foreground">
                        Connect GitHub or Gitea in Settings → Integrations to link repositories.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {project.repositoryProvider && project.repositoryFullName && (
                <div className="border-t pt-4 mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <RefreshCw className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-medium">Issue Sync</h3>
                        <p className="text-sm text-muted-foreground">
                          Sync tasks with {project.repositoryProvider} issues
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={issueSyncEnabled}
                      onCheckedChange={setIssueSyncEnabled}
                    />
                  </div>

                  {issueSyncEnabled && (
                    <div className="pl-12 space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm">Sync Direction</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { value: "bidirectional", label: "Two-way" },
                            { value: "outbound_only", label: "Task → Issue" },
                            { value: "inbound_only", label: "Issue → Task" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setIssueSyncDirection(option.value as "outbound_only" | "inbound_only" | "bidirectional")}
                              className={cn(
                                "px-3 py-2 text-sm rounded-md border transition-colors",
                                issueSyncDirection === option.value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border hover:bg-muted"
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {issueSyncDirection === "bidirectional" && "Status changes sync both ways between tasks and issues."}
                          {issueSyncDirection === "outbound_only" && "Task status changes update the external issue, but not vice versa."}
                          {issueSyncDirection === "inbound_only" && "External issue changes update the task, but not vice versa."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-4 mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Bob Overrides</h3>
                    <p className="text-sm text-muted-foreground">
                      Override workspace Bob defaults for this project.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bob-launch-policy">Launch Policy</Label>
                  <select
                    id="bob-launch-policy"
                    value={bobLaunchPolicy}
                    onChange={(event) =>
                      setBobLaunchPolicy(event.target.value as "auto_or_manual" | "manual_only")
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="auto_or_manual">Use auto start when available</option>
                    <option value="manual_only">Require manual start</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bob-awaiting-timeout">Awaiting-Input Timeout (minutes)</Label>
                  <Input
                    id="bob-awaiting-timeout"
                    type="number"
                    min={1}
                    max={1440}
                    value={bobAwaitingInputTimeoutMinutes}
                    onChange={(event) => setBobAwaitingInputTimeoutMinutes(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4 -mx-4 px-4 mt-4">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {hasChanges ? "Cancel" : "Close"}
                </Button>
                {hasChanges && (
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    onClick={async () => {
                      setIsSubmitting(true);
                      try {
                        await onSubmit({
                          forgeRepositoryId: createForgeRepositoryMode
                            ? undefined
                            : forgeRepositoryId !== (project.forgeRepositoryId ?? null)
                              ? forgeRepositoryId
                              : undefined,
                          createForgeRepository: createForgeRepositoryMode
                            ? true
                            : undefined,
                          forgeRepositoryName: createForgeRepositoryMode
                            ? createForgeRepositoryName.trim() || undefined
                            : undefined,
                          forgeRepositoryStorageBackend: createForgeRepositoryMode
                            ? createForgeRepositoryStorageBackend
                            : undefined,
                          forgeRepositoryStoragePrefix: createForgeRepositoryMode
                            ? createForgeRepositoryStoragePrefix.trim() || undefined
                            : undefined,
                          issueSyncEnabled: issueSyncEnabled !== (project.issueSyncEnabled ?? false) ? issueSyncEnabled : undefined,
                          issueSyncDirection: issueSyncDirection !== (project.issueSyncDirection ?? "bidirectional") ? issueSyncDirection : undefined,
                          bobLaunchPolicy:
                            bobLaunchPolicy !== (project.bobLaunchPolicy ?? "auto_or_manual")
                              ? bobLaunchPolicy
                              : undefined,
                          bobAwaitingInputTimeoutMinutes:
                            Number(bobAwaitingInputTimeoutMinutes) !== (project.bobAwaitingInputTimeoutMinutes ?? 30)
                              ? Number(bobAwaitingInputTimeoutMinutes)
                              : undefined,
                        });
                        onClose();
                      } catch (error) {
                        console.error("Failed to update settings:", error);
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save changes"
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </Tabs>
      </div>
    </div>
  );
}

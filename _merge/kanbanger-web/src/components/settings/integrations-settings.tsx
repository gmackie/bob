"use client";

import { useEffect, useMemo, useState } from "react";
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
  Avatar,
  AvatarFallback,
  AvatarImage,
  Separator,
  Checkbox,
} from "@linear-clone/ui";
import {
  Github,
  GitBranch,
  Loader2,
  Check,
  ExternalLink,
  Unlink,
  FolderPlus,
  Webhook,
  Lock,
  Globe,
  RefreshCw,
  AlertCircle,
  Link2,
  Package,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface Repository {
  id: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  owner: string;
  ownerAvatar: string;
  updatedAt: string;
  provider?: "github" | "gitea";
}

interface IntegrationsSettingsProps {
  workspaceId: string | null;
}

export function IntegrationsSettings({ workspaceId }: IntegrationsSettingsProps) {
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [setupWebhook, setSetupWebhook] = useState(true);

  const utils = api.useUtils();
  
  const { data: user } = api.user.me.useQuery();
  const { data: integrations } = api.integration.list.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId }
  );
  const { data: githubData, isLoading: githubLoading, refetch: refetchGithub } = api.integration.getGitHubRepos.useQuery();
  const { data: giteaData, isLoading: giteaLoading, refetch: refetchGitea } = api.integration.getGiteaRepos.useQuery();
  const { data: webhooksList, refetch: refetchWebhooks } = api.integration.listWebhooks.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId }
  );

  const disconnectGitHub = api.integration.disconnectGitHub.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      utils.integration.getGitHubRepos.invalidate();
    },
  });

  const disconnectGitea = api.integration.disconnectGitea.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      utils.integration.getGiteaRepos.invalidate();
    },
  });

  const createProject = api.integration.createProjectFromRepo.useMutation({
    onSuccess: () => {
      setShowCreateProject(false);
      setSelectedRepo(null);
      setProjectName("");
      setProjectKey("");
    },
  });

  const bulkImport = api.integration.bulkImportRepos.useMutation({
    onSuccess: () => {
      setSelectedRepos(new Set());
    },
  });

  const setupWebhookMutation = api.integration.setupWebhookForRepo.useMutation();

  const deleteWebhook = api.integration.deleteWebhook.useMutation({
    onSuccess: () => {
      refetchWebhooks();
    },
  });

  const toggleWebhook = api.integration.toggleWebhook.useMutation({
    onSuccess: () => {
      refetchWebhooks();
    },
  });

  const bobIntegration = useMemo(
    () => integrations?.find((integration) => integration.type === "bob") ?? null,
    [integrations]
  );

  const [bobBaseUrl, setBobBaseUrl] = useState("");
  const [bobSharedSecret, setBobSharedSecret] = useState("");
  const [bobLaunchPolicy, setBobLaunchPolicy] = useState<"auto_or_manual" | "manual_only">("auto_or_manual");
  const [bobTimeoutMinutes, setBobTimeoutMinutes] = useState("30");

  useEffect(() => {
    const settings = (bobIntegration?.settings ?? {}) as {
      baseUrl?: string;
      sharedSecret?: string;
      launchPolicy?: "auto_or_manual" | "manual_only";
      defaultAwaitingInputTimeoutMinutes?: number;
    };

    setBobBaseUrl(settings.baseUrl ?? "");
    setBobSharedSecret(settings.sharedSecret ?? "");
    setBobLaunchPolicy(settings.launchPolicy ?? "auto_or_manual");
    setBobTimeoutMinutes(
      settings.defaultAwaitingInputTimeoutMinutes
        ? String(settings.defaultAwaitingInputTimeoutMinutes)
        : "30"
    );
  }, [bobIntegration]);

  const createBobIntegration = api.integration.create.useMutation({
    onSuccess: () => {
      utils.integration.list.invalidate({ workspaceId: workspaceId ?? "" });
    },
  });

  const updateBobIntegration = api.integration.update.useMutation({
    onSuccess: () => {
      utils.integration.list.invalidate({ workspaceId: workspaceId ?? "" });
    },
  });

  const allRepos = useMemo(() => {
    const repos: (Repository & { provider: "github" | "gitea" })[] = [];
    
    if (githubData?.repos) {
      repos.push(...githubData.repos.map((r) => ({ ...r, provider: "github" as const })));
    }
    if (giteaData?.repos) {
      repos.push(...giteaData.repos.map((r) => ({ ...r, provider: "gitea" as const })));
    }
    
    return repos;
  }, [githubData?.repos, giteaData?.repos]);

  const reposByName = useMemo(() => {
    const map = new Map<string, typeof allRepos>();
    for (const repo of allRepos) {
      const normalizedName = repo.name.toLowerCase();
      const existing = map.get(normalizedName) ?? [];
      existing.push(repo);
      map.set(normalizedName, existing);
    }
    return map;
  }, [allRepos]);

  const selectedReposList = useMemo(() => {
    return allRepos.filter((r) => selectedRepos.has(`${r.provider}-${r.id}`));
  }, [allRepos, selectedRepos]);

  const projectsToCreate = useMemo(() => {
    const byName = new Map<string, typeof selectedReposList>();
    for (const repo of selectedReposList) {
      const normalizedName = repo.name.toLowerCase();
      const existing = byName.get(normalizedName) ?? [];
      existing.push(repo);
      byName.set(normalizedName, existing);
    }
    return Array.from(byName.entries()).map(([_name, repos]) => ({
      name: repos[0]!.name,
      repos,
      isCombined: repos.length > 1,
    }));
  }, [selectedReposList]);

  const toggleRepo = (provider: string, id: string) => {
    const key = `${provider}-${id}`;
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllMatching = () => {
    const newSelection = new Set<string>();
    for (const [, repos] of reposByName) {
      if (repos.length > 1) {
        for (const repo of repos) {
          newSelection.add(`${repo.provider}-${repo.id}`);
        }
      }
    }
    setSelectedRepos(newSelection);
  };

  const selectAll = () => {
    const newSelection = new Set<string>();
    for (const repo of allRepos) {
      newSelection.add(`${repo.provider}-${repo.id}`);
    }
    setSelectedRepos(newSelection);
  };

  const clearSelection = () => {
    setSelectedRepos(new Set());
  };

  const handleBulkImport = async () => {
    if (!workspaceId || selectedReposList.length === 0) return;

    await bulkImport.mutateAsync({
      workspaceId,
      repos: selectedReposList.map((r) => ({
        provider: r.provider,
        id: r.id,
        name: r.name,
        fullName: r.fullName,
        url: r.url,
        defaultBranch: r.defaultBranch,
      })),
      setupWebhooks: setupWebhook,
    });
  };

  const handleCreateProject = async () => {
    if (!selectedRepo || !workspaceId) return;

    const provider = githubData?.repos?.some((r) => r.id === selectedRepo.id) ? "github" : "gitea";

    const project = await createProject.mutateAsync({
      workspaceId,
      provider: provider as "github" | "gitea",
      repoId: selectedRepo.id,
      repoName: selectedRepo.name,
      repoFullName: selectedRepo.fullName,
      repoUrl: selectedRepo.url,
      defaultBranch: selectedRepo.defaultBranch,
      projectName: projectName || undefined,
      projectKey: projectKey || undefined,
    });

    if (setupWebhook && project) {
      try {
        await setupWebhookMutation.mutateAsync({
          workspaceId,
          provider: provider as "github" | "gitea",
          repoFullName: selectedRepo.fullName,
          events: ["push", "pull_request"],
        });
      } catch (err) {
        console.error("Webhook setup failed:", err);
      }
    }
  };

  const openRepoModal = (repo: Repository) => {
    setSelectedRepo(repo);
    setProjectName(repo.name);
    setProjectKey(repo.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
    setShowCreateProject(true);
  };

  const getMatchingRepos = (repo: Repository) => {
    const normalizedName = repo.name.toLowerCase();
    return reposByName.get(normalizedName) ?? [];
  };

  const GiteaIcon = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.248 2.97 0 7.091-4.953 7.091-4.953s-.79-.085-1.91-.085c-1.12 0-1.654.428-2.482.428-.828 0-1.264-.31-1.264-.31s1.615-1.138 1.615-2.427c0-.73-.37-1.184-.37-1.184s1.002-.27 1.002-1.377c0-1.107-.83-1.685-.83-1.685s.705-1.018.705-1.92c0-.9-.7-1.6-.7-1.6s1.632-.35 1.632-2.185C13.31.647 11.942 0 10.834 0 9.726 0 4.456 4.603 4.209 4.603z" />
    </svg>
  );

  const RepoRow = ({ repo, provider }: { repo: Repository; provider: "github" | "gitea" }) => {
    const key = `${provider}-${repo.id}`;
    const isSelected = selectedRepos.has(key);
    const matchingRepos = getMatchingRepos(repo);
    const hasMatch = matchingRepos.length > 1;

    return (
      <div
        className={`flex items-center justify-between gap-2 p-3 rounded-lg border hover:bg-muted/50 transition-colors ${
          isSelected ? "border-primary bg-primary/5" : ""
        } ${hasMatch ? "ring-1 ring-blue-500/30" : ""}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleRepo(provider, repo.id)}
            disabled={!workspaceId}
            className="flex-shrink-0"
          />
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarImage src={repo.ownerAvatar} />
            <AvatarFallback>{repo.owner[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate max-w-[200px]">{repo.fullName}</p>
              {repo.private ? (
                <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              ) : (
                <Globe className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              )}
              {hasMatch && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/50 text-xs flex-shrink-0">
                  <Link2 className="mr-1 h-3 w-3" />
                  {matchingRepos.length}
                </Badge>
              )}
            </div>
            {repo.description && (
              <p className="text-xs text-muted-foreground truncate max-w-[300px]">{repo.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a href={repo.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openRepoModal(repo)}
            disabled={!workspaceId}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bob Integration</CardTitle>
          <CardDescription>
            Configure the trusted Bob deployment for this workspace. Kanbanger uses this
            integration to start and manage Bob-backed issue runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bob-base-url">Bob Base URL</Label>
              <Input
                id="bob-base-url"
                value={bobBaseUrl}
                onChange={(event) => setBobBaseUrl(event.target.value)}
                placeholder="https://bob.example.internal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bob-shared-secret">Shared Secret</Label>
              <Input
                id="bob-shared-secret"
                value={bobSharedSecret}
                onChange={(event) => setBobSharedSecret(event.target.value)}
                placeholder="workspace-shared-secret"
              />
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
                <option value="auto_or_manual">Auto start allowed</option>
                <option value="manual_only">Manual start only</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bob-timeout">Default Awaiting-Input Timeout (minutes)</Label>
              <Input
                id="bob-timeout"
                type="number"
                min={1}
                max={1440}
                value={bobTimeoutMinutes}
                onChange={(event) => setBobTimeoutMinutes(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-medium">Comment mirroring</p>
              <p className="text-sm text-muted-foreground">
                Keep Kanbanger comments concise and milestone-oriented.
              </p>
            </div>
            <Badge variant="outline">Milestones only</Badge>
          </div>

          <div className="flex justify-end">
            <Button
              disabled={
                !workspaceId ||
                createBobIntegration.isPending ||
                updateBobIntegration.isPending
              }
              onClick={async () => {
                if (!workspaceId) return;

                const settings = {
                  baseUrl: bobBaseUrl,
                  sharedSecret: bobSharedSecret,
                  launchPolicy: bobLaunchPolicy,
                  defaultAwaitingInputTimeoutMinutes: Number(bobTimeoutMinutes),
                  commentMirroring: "milestones_only" as const,
                };

                if (bobIntegration) {
                  await updateBobIntegration.mutateAsync({
                    id: bobIntegration.id,
                    settings,
                    enabled: true,
                  });
                  return;
                }

                await createBobIntegration.mutateAsync({
                  workspaceId,
                  type: "bob",
                  name: "Bob",
                  settings,
                });
              }}
            >
              {createBobIntegration.isPending || updateBobIntegration.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : bobIntegration ? (
                "Save Bob Settings"
              ) : (
                "Create Bob Integration"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Git Integrations</CardTitle>
          <CardDescription>
            Connect your GitHub and Gitea accounts to link repositories with projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#24292e]">
                <Github className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="font-medium">GitHub</p>
                {user?.githubUsername ? (
                  <p className="text-sm text-muted-foreground">
                    Connected as <span className="font-medium">{user.githubUsername}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not connected</p>
                )}
              </div>
            </div>
            {user?.githubUsername ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/50">
                  <Check className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnectGitHub.mutate()}
                  disabled={disconnectGitHub.isPending}
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button asChild>
                <a href="/api/integrations/github/connect?returnUrl=/dashboard/settings">
                  Connect GitHub
                </a>
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#609926]">
                <GiteaIcon />
              </div>
              <div>
                <p className="font-medium">Gitea</p>
                {user?.giteaUsername ? (
                  <p className="text-sm text-muted-foreground">
                    Connected as <span className="font-medium">{user.giteaUsername}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not connected</p>
                )}
              </div>
            </div>
            {user?.giteaUsername ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/50">
                  <Check className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnectGitea.mutate()}
                  disabled={disconnectGitea.isPending}
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button asChild>
                <a href="/api/integrations/gitea/connect?returnUrl=/dashboard/settings">
                  Connect Gitea
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(githubData?.connected || giteaData?.connected) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Repositories</CardTitle>
                <CardDescription>
                  Select repositories to import. Repos with the same name across GitHub/Gitea will be combined into one project.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {githubData?.connected && (
                  <Button variant="outline" size="sm" onClick={() => refetchGithub()}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${githubLoading ? "animate-spin" : ""}`} />
                    GitHub
                  </Button>
                )}
                {giteaData?.connected && (
                  <Button variant="outline" size="sm" onClick={() => refetchGitea()}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${giteaLoading ? "animate-spin" : ""}`} />
                    Gitea
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedRepos.size > 0 && (
              <div className="mb-4 p-4 rounded-lg border bg-muted/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-primary" />
                    <span className="font-medium">
                      {selectedRepos.size} repo{selectedRepos.size !== 1 ? "s" : ""} selected
                      {projectsToCreate.length !== selectedRepos.size && (
                        <span className="text-muted-foreground ml-1">
                          → {projectsToCreate.length} project{projectsToCreate.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                      Clear
                    </Button>
                    <Button
                      onClick={handleBulkImport}
                      disabled={!workspaceId || bulkImport.isPending}
                    >
                      {bulkImport.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <FolderPlus className="mr-2 h-4 w-4" />
                          Import Selected
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {projectsToCreate.some((p) => p.isCombined) && (
                  <div className="text-sm text-muted-foreground">
                    <span className="text-blue-500 font-medium">
                      {projectsToCreate.filter((p) => p.isCombined).length} combined project(s)
                    </span>
                    {" will link repos from both GitHub and Gitea"}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              {githubData?.connected && giteaData?.connected && (
                <Button variant="outline" size="sm" onClick={selectAllMatching}>
                  <Link2 className="mr-2 h-4 w-4" />
                  Select Matching
                </Button>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  id="setup-webhooks"
                  checked={setupWebhook}
                  onCheckedChange={(checked: boolean | "indeterminate") => setSetupWebhook(checked === true)}
                />
                <label htmlFor="setup-webhooks" className="cursor-pointer">
                  Setup webhooks automatically
                </label>
              </div>
            </div>

            {(githubLoading || giteaLoading) ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-6">
                {githubData?.repos && githubData.repos.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Github className="h-4 w-4" />
                      <h3 className="text-sm font-medium">GitHub Repositories</h3>
                      <Badge variant="secondary" className="text-xs">
                        {githubData.repos.length}
                      </Badge>
                    </div>
                    <div className="grid gap-2">
                      {githubData.repos.map((repo) => (
                        <RepoRow key={`github-${repo.id}`} repo={repo} provider="github" />
                      ))}
                    </div>
                  </div>
                )}

                {giteaData?.repos && giteaData.repos.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <GiteaIcon />
                      <h3 className="text-sm font-medium">Gitea Repositories</h3>
                      <Badge variant="secondary" className="text-xs">
                        {giteaData.repos.length}
                      </Badge>
                    </div>
                    <div className="grid gap-2">
                      {giteaData.repos.map((repo) => (
                        <RepoRow key={`gitea-${repo.id}`} repo={repo} provider="gitea" />
                      ))}
                    </div>
                  </div>
                )}

                {(!githubData?.repos?.length && !giteaData?.repos?.length) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <GitBranch className="mx-auto h-12 w-12 opacity-50 mb-4" />
                    <p>No repositories found</p>
                    <p className="text-sm">Your connected accounts don&apos;t have any repositories yet.</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {workspaceId && webhooksList && webhooksList.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-5 w-5" />
                  Configured Webhooks
                </CardTitle>
                <CardDescription>
                  Manage webhooks that link commits and PRs to your issues.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchWebhooks()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {webhooksList.map((webhook) => (
                <div
                  key={webhook.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    webhook.enabled ? "border-border" : "border-muted bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      webhook.provider === "github" ? "bg-[#24292e]" : "bg-[#609926]"
                    }`}>
                      {webhook.provider === "github" ? (
                        <Github className="h-4 w-4 text-white" />
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="white">
                          <path d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.248 2.97 0 7.091-4.953 7.091-4.953s-.79-.085-1.91-.085c-1.12 0-1.654.428-2.482.428-.828 0-1.264-.31-1.264-.31s1.615-1.138 1.615-2.427c0-.73-.37-1.184-.37-1.184s1.002-.27 1.002-1.377c0-1.107-.83-1.685-.83-1.685s.705-1.018.705-1.92c0-.9-.7-1.6-.7-1.6s1.632-.35 1.632-2.185C13.31.647 11.942 0 10.834 0 9.726 0 4.456 4.603 4.209 4.603z" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium truncate ${!webhook.enabled && "text-muted-foreground"}`}>
                        {webhook.repositoryUrl}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="capitalize">{webhook.provider}</span>
                        <span>•</span>
                        <span>{(webhook.events as string[])?.join(", ") || "push, pull_request"}</span>
                        {!webhook.enabled && (
                          <>
                            <span>•</span>
                            <span className="text-yellow-500">Disabled</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleWebhook.mutate({ id: webhook.id, enabled: !webhook.enabled })}
                      disabled={toggleWebhook.isPending}
                    >
                      {webhook.enabled ? (
                        <ToggleRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      onClick={() => {
                        if (confirm("Delete this webhook? It will need to be removed from the repository settings manually.")) {
                          deleteWebhook.mutate({ id: webhook.id });
                        }
                      }}
                      disabled={deleteWebhook.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!workspaceId && (githubData?.connected || giteaData?.connected) && (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-500">No workspace selected</p>
                <p className="text-sm text-muted-foreground">
                  Select a workspace in the Workspaces tab to create projects from repositories.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showCreateProject && selectedRepo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Create Project from Repository</CardTitle>
              <CardDescription>
                Link <span className="font-medium">{selectedRepo.fullName}</span> to a new project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  placeholder="e.g., My Project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="project-key">Project Key</Label>
                <Input
                  id="project-key"
                  placeholder="e.g., PROJ"
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  maxLength={10}
                />
                <p className="text-xs text-muted-foreground">
                  Used as prefix for issue identifiers (e.g., {projectKey || "PROJ"}-1)
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Setup Webhook</p>
                    <p className="text-xs text-muted-foreground">
                      Auto-link commits and PRs to issues
                    </p>
                  </div>
                </div>
                <Button
                  variant={setupWebhook ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSetupWebhook(!setupWebhook)}
                >
                  {setupWebhook ? "Enabled" : "Disabled"}
                </Button>
              </div>

              {setupWebhook && (
                <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Webhook will be configured for:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Push events - link commits mentioning issue IDs</li>
                    <li>Pull request events - link PRs and auto-close on merge</li>
                  </ul>
                </div>
              )}
            </CardContent>
            <div className="flex justify-end gap-2 p-6 pt-0">
              <Button variant="outline" onClick={() => setShowCreateProject(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateProject}
                disabled={!projectName.trim() || createProject.isPending}
              >
                {createProject.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Project"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

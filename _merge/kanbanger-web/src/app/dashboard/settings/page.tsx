"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
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
  Avatar,
  AvatarFallback,
  Separator,
} from "@linear-clone/ui";
import { CreateWorkspaceModal } from "@/components/workspace/create-workspace-modal";
import { CreateTeamModal } from "@/components/team/create-team-modal";
import {
  User,
  Building2,
  Palette,
  Moon,
  Sun,
  Monitor,
  Plus,
  Loader2,
  Check,
  Users,
  ChevronRight,
  Key,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  AlertCircle,
  GitBranch,
  Webhook,
  Bot,
} from "lucide-react";
import { IntegrationsSettings } from "@/components/settings/integrations-settings";
import { WebhooksSettings } from "@/components/settings/webhooks-settings";
import { AgentsSettings } from "@/components/settings/agents-settings";

type SettingsTab = "profile" | "workspaces" | "integrations" | "webhooks" | "agents" | "appearance" | "api-keys";

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedWorkspaceSlug, setSelectedWorkspaceSlug] = useState<string | null>(null);

  // Profile form state
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // API Key state
  const [showCreateApiKey, setShowCreateApiKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read", "write"]);
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>("90");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Theme
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Ensure we're mounted before showing theme UI (prevents hydration mismatch)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch current user
  const { data: user, isLoading: userLoading } = api.user.me.useQuery();

  // Fetch workspaces
  const { data: workspaces, isLoading: workspacesLoading } = api.workspace.list.useQuery();

  // Fetch API keys
  const { data: apiKeys, isLoading: apiKeysLoading } = api.user.listApiKeys.useQuery();

  // Fetch teams for selected workspace
  const { data: teams } = api.team.list.useQuery(
    { workspaceId: selectedWorkspaceId ?? "" },
    { enabled: !!selectedWorkspaceId }
  );

  // Update profile mutation
  const utils = api.useUtils();
  const updateProfile = api.user.updateProfile.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      setIsSaving(false);
    },
    onError: () => {
      setIsSaving(false);
    },
  });

  const createApiKey = api.user.createApiKey.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setShowCreateApiKey(false);
      setNewKeyName("");
      utils.user.listApiKeys.invalidate();
    },
  });

  const revokeApiKey = api.user.revokeApiKey.useMutation({
    onSuccess: () => {
      utils.user.listApiKeys.invalidate();
    },
  });

  // Initialize form when user loads
  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
    }
  }, [user]);

  // Initialize selected workspace
  useEffect(() => {
    if (workspaces && workspaces.length > 0 && !selectedWorkspaceId) {
      setSelectedWorkspaceId(workspaces[0]!.workspace.id);
      setSelectedWorkspaceSlug(workspaces[0]!.workspace.slug);
    }
  }, [workspaces, selectedWorkspaceId]);

  const handleSaveProfile = () => {
    setIsSaving(true);
    updateProfile.mutate({ name: name.trim() });
  };

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: User },
    { id: "workspaces" as const, label: "Workspaces", icon: Building2 },
    { id: "integrations" as const, label: "Integrations", icon: GitBranch },
    { id: "webhooks" as const, label: "Webhooks", icon: Webhook },
    { id: "agents" as const, label: "AI Agents", icon: Bot },
    { id: "api-keys" as const, label: "API Keys", icon: Key },
    { id: "appearance" as const, label: "Appearance", icon: Palette },
  ];

  const handleCreateApiKey = () => {
    if (!newKeyName.trim()) return;
    createApiKey.mutate({
      name: newKeyName.trim(),
      scopes: newKeyScopes as ("read" | "write" | "admin")[],
      expiresInDays: newKeyExpiry ? parseInt(newKeyExpiry) : undefined,
    });
  };

  const handleCopyKey = async () => {
    if (createdKey) {
      await navigator.clipboard.writeText(createdKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences.
        </p>
      </div>
      <Separator />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
        {/* Sidebar navigation */}
        <aside className="-mx-4 lg:w-1/5">
          <nav className="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 px-4 lg:px-0">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                variant="ghost"
                className={`justify-start ${activeTab === tab.id ? "bg-muted" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon className="mr-2 h-4 w-4" />
                {tab.label}
              </Button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex-1 lg:max-w-2xl">
          {/* Profile Tab */}
          {activeTab === "profile" && (
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>
                  Update your profile information.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarFallback className="text-lg">
                      {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{user?.name ?? "No name set"}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={user?.email ?? ""}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email is managed by your authentication provider
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : saveSuccess ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Saved!
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Workspaces Tab */}
          {activeTab === "workspaces" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Your Workspaces</CardTitle>
                      <CardDescription>
                        Workspaces you&apos;re a member of.
                      </CardDescription>
                    </div>
                    <Button onClick={() => setShowCreateWorkspace(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      New Workspace
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {workspacesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : workspaces && workspaces.length > 0 ? (
                    <div className="space-y-2">
                      {workspaces.map((membership) => (
                        <div
                          key={membership.workspace.id}
                          className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                            selectedWorkspaceId === membership.workspace.id
                              ? "border-primary bg-muted"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => {
                            setSelectedWorkspaceId(membership.workspace.id);
                            setSelectedWorkspaceSlug(membership.workspace.slug);
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                              <Building2 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{membership.workspace.name}</p>
                              <p className="text-sm text-muted-foreground">
                                /{membership.workspace.slug} &bull; {membership.role}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/dashboard/${membership.workspace.slug}`);
                            }}
                          >
                            Open
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Building2 className="mx-auto h-12 w-12 opacity-50 mb-4" />
                      <p>No workspaces yet</p>
                      <p className="text-sm">Create your first workspace to get started</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Teams section for selected workspace */}
              {selectedWorkspaceId && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>Teams</CardTitle>
                        <CardDescription>
                          Teams in {workspaces?.find((w) => w.workspace.id === selectedWorkspaceId)?.workspace.name}
                        </CardDescription>
                      </div>
                      <Button onClick={() => setShowCreateTeam(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Team
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {teams && teams.length > 0 ? (
                      <div className="space-y-2">
                        {teams.map((team) => (
                          <div
                            key={team.id}
                            className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="flex h-10 w-10 items-center justify-center rounded-lg"
                                style={{ backgroundColor: team.color ?? "#6366f1" }}
                              >
                                <Users className="h-5 w-5 text-white" />
                              </div>
                              <div>
                                <p className="font-medium">{team.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {team.key} &bull; {team.description ?? "No description"}
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(`/dashboard/${selectedWorkspaceSlug}/${team.key}/issues`)}
                            >
                              View Issues
                              <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Users className="mx-auto h-12 w-12 opacity-50 mb-4" />
                        <p>No teams yet</p>
                        <p className="text-sm">Create a team to start tracking issues</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === "integrations" && (
            <IntegrationsSettings workspaceId={selectedWorkspaceId} />
          )}

          {/* Webhooks Tab */}
          {activeTab === "webhooks" && (
            <WebhooksSettings workspaceId={selectedWorkspaceId} />
          )}

          {/* Agents Tab */}
          {activeTab === "agents" && (
            <AgentsSettings workspaceId={selectedWorkspaceId} />
          )}

          {/* API Keys Tab */}
          {activeTab === "api-keys" && (
            <div className="space-y-6">
              {createdKey && (
                <Card className="border-green-500 bg-green-500/10">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-600">
                      <AlertCircle className="h-5 w-5" />
                      API Key Created
                    </CardTitle>
                    <CardDescription>
                      Copy this key now. You won&apos;t be able to see it again!
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-muted p-3 font-mono text-sm break-all">
                        {showKey ? createdKey : createdKey.substring(0, 8) + "•".repeat(40)}
                      </code>
                      <Button variant="outline" size="icon" onClick={() => setShowKey(!showKey)}>
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button variant="outline" size="icon" onClick={handleCopyKey}>
                        {copiedKey ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      className="mt-4"
                      onClick={() => setCreatedKey(null)}
                    >
                      Dismiss
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>API Keys</CardTitle>
                      <CardDescription>
                        Manage API keys for programmatic access to your account.
                      </CardDescription>
                    </div>
                    <Button onClick={() => setShowCreateApiKey(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      New API Key
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {apiKeysLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : apiKeys && apiKeys.length > 0 ? (
                    <div className="space-y-3">
                      {apiKeys.filter(k => !k.revokedAt).map((apiKey) => (
                        <div
                          key={apiKey.id}
                          className="flex items-center justify-between rounded-lg border p-4"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                              <Key className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">{apiKey.name}</p>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <code className="rounded bg-muted px-1">{apiKey.keyPrefix}...</code>
                                <span>•</span>
                                <span>{(apiKey.scopes as string[]).join(", ")}</span>
                                {apiKey.lastUsedAt && (
                                  <>
                                    <span>•</span>
                                    <span>Last used {new Date(apiKey.lastUsedAt).toLocaleDateString()}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => revokeApiKey.mutate({ id: apiKey.id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Key className="mx-auto h-12 w-12 opacity-50 mb-4" />
                      <p>No API keys yet</p>
                      <p className="text-sm">Create an API key to integrate with external tools</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Usage</CardTitle>
                  <CardDescription>
                    How to use your API key with the Tasks API.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">HTTP Header</p>
                    <code className="block rounded bg-muted p-3 text-sm">
                      x-api-key: lc_your_api_key_here
                    </code>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Or Bearer Token</p>
                    <code className="block rounded bg-muted p-3 text-sm">
                      Authorization: Bearer lc_your_api_key_here
                    </code>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Example Request</p>
                    <code className="block rounded bg-muted p-3 text-sm whitespace-pre">
{`curl -X GET "https://tasks.gmac.io/api/trpc/issue.list" \\
  -H "x-api-key: lc_your_api_key_here" \\
  -H "Content-Type: application/json"`}
                    </code>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>MCP Server for Claude</CardTitle>
                  <CardDescription>
                    Use the Tasks MCP server to let Claude manage your tasks.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">Claude Desktop Configuration</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      Add this to your <code className="rounded bg-muted px-1">claude_desktop_config.json</code>:
                    </p>
                    <code className="block rounded bg-muted p-3 text-sm whitespace-pre overflow-x-auto">
{`{
  "mcpServers": {
    "tasks": {
      "command": "npx",
      "args": ["@linear-clone/mcp"],
      "env": {
        "TASKS_API_KEY": "lc_your_api_key_here",
        "TASKS_API_URL": "https://tasks.gmac.io"
      }
    }
  }
}`}
                    </code>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Available Tools</p>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li><code className="rounded bg-muted px-1">list_workspaces</code> - List your workspaces</li>
                      <li><code className="rounded bg-muted px-1">list_projects</code> - List projects in a workspace</li>
                      <li><code className="rounded bg-muted px-1">list_tasks</code> - Search and filter tasks</li>
                      <li><code className="rounded bg-muted px-1">get_task</code> - Get task details</li>
                      <li><code className="rounded bg-muted px-1">create_task</code> - Create a new task</li>
                      <li><code className="rounded bg-muted px-1">update_task</code> - Update task status, priority, etc.</li>
                      <li><code className="rounded bg-muted px-1">add_comment</code> - Add a comment to a task</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === "appearance" && (
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize how Tasks looks on your device.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Theme</Label>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select the theme for the interface.
                  </p>
                  {mounted && (
                    <div className="grid grid-cols-3 gap-4">
                      <button
                        onClick={() => setTheme("light")}
                        className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                          theme === "light"
                            ? "border-primary bg-muted"
                            : "border-muted hover:border-muted-foreground/50"
                        }`}
                      >
                        <Sun className="h-6 w-6" />
                        <span className="text-sm font-medium">Light</span>
                      </button>
                      <button
                        onClick={() => setTheme("dark")}
                        className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                          theme === "dark"
                            ? "border-primary bg-muted"
                            : "border-muted hover:border-muted-foreground/50"
                        }`}
                      >
                        <Moon className="h-6 w-6" />
                        <span className="text-sm font-medium">Dark</span>
                      </button>
                      <button
                        onClick={() => setTheme("system")}
                        className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                          theme === "system"
                            ? "border-primary bg-muted"
                            : "border-muted hover:border-muted-foreground/50"
                        }`}
                      >
                        <Monitor className="h-6 w-6" />
                        <span className="text-sm font-medium">System</span>
                      </button>
                    </div>
                  )}
                </div>

                {mounted && (
                  <div className="rounded-lg bg-muted p-4">
                    <p className="text-sm text-muted-foreground">
                      Current theme: <span className="font-medium text-foreground">{resolvedTheme ?? "loading..."}</span>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateWorkspace && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWorkspace(false)}
          onSuccess={() => utils.workspace.list.invalidate()}
        />
      )}

      {showCreateTeam && selectedWorkspaceId && selectedWorkspaceSlug && (
        <CreateTeamModal
          workspaceId={selectedWorkspaceId}
          workspaceSlug={selectedWorkspaceSlug}
          onClose={() => setShowCreateTeam(false)}
          onSuccess={() => utils.team.list.invalidate()}
        />
      )}

      {showCreateApiKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Create API Key</CardTitle>
              <CardDescription>
                Create a new API key for programmatic access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g., Control Panel Integration"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label>Permissions</Label>
                <div className="flex flex-wrap gap-2">
                  {["read", "write", "admin"].map((scope) => (
                    <Button
                      key={scope}
                      variant={newKeyScopes.includes(scope) ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setNewKeyScopes(
                          newKeyScopes.includes(scope)
                            ? newKeyScopes.filter((s) => s !== scope)
                            : [...newKeyScopes, scope]
                        );
                      }}
                    >
                      {scope}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="key-expiry">Expires in (days)</Label>
                <Input
                  id="key-expiry"
                  type="number"
                  placeholder="90"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for no expiration
                </p>
              </div>
            </CardContent>
            <div className="flex justify-end gap-2 p-6 pt-0">
              <Button variant="outline" onClick={() => setShowCreateApiKey(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateApiKey}
                disabled={!newKeyName.trim() || createApiKey.isPending}
              >
                {createApiKey.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Key"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

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
  Avatar,
  AvatarFallback,
  Separator,
  Checkbox,
} from "@linear-clone/ui";
import {
  Bot,
  Loader2,
  Plus,
  Check,
  Activity,
  CircleDot,
  ChevronRight,
  ChevronDown,
  Zap,
  Target,
  AlertCircle,
} from "lucide-react";

interface AgentsSettingsProps {
  workspaceId: string | null;
}

type AgentConfig = {
  capabilities: string[];
  allowedProjects: string[];
  allowedLabels: string[];
  excludedLabels: string[];
  maxConcurrentTasks: number;
  autoClaimEnabled: boolean;
  autoClaimCriteria?: {
    priorities: string[];
    statuses: string[];
    maxEstimate?: number;
  };
  avatar?: {
    primaryColor: string;
    accentColor: string;
    variant: "default" | "friendly" | "technical" | "creative";
  };
};

const defaultConfig: AgentConfig = {
  capabilities: [],
  allowedProjects: [],
  allowedLabels: [],
  excludedLabels: [],
  maxConcurrentTasks: 1,
  autoClaimEnabled: false,
};

const CAPABILITY_OPTIONS = [
  { id: "code", label: "Code Changes", description: "Can make code modifications" },
  { id: "docs", label: "Documentation", description: "Can write and update docs" },
  { id: "tests", label: "Testing", description: "Can write and run tests" },
  { id: "review", label: "Code Review", description: "Can review pull requests" },
  { id: "planning", label: "Planning", description: "Can create sub-tasks and plans" },
];

const AVATAR_COLORS = [
  { primary: "#6366f1", accent: "#818cf8" },
  { primary: "#8b5cf6", accent: "#a78bfa" },
  { primary: "#06b6d4", accent: "#22d3ee" },
  { primary: "#10b981", accent: "#34d399" },
  { primary: "#f59e0b", accent: "#fbbf24" },
  { primary: "#ef4444", accent: "#f87171" },
];

export function AgentsSettings({ workspaceId }: AgentsSettingsProps) {
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [_editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentConfig, setNewAgentConfig] = useState<AgentConfig>(defaultConfig);
  const [selectedColor, setSelectedColor] = useState(0);

  const utils = api.useUtils();

  const { data: agents, isLoading } = api.agent.list.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId }
  );

  const { data: stats } = api.agent.getWorkspaceAgentStats.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId }
  );

  const { data: projects } = api.project.list.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId }
  );

  const createAgent = api.agent.create.useMutation({
    onSuccess: () => {
      setShowCreateAgent(false);
      resetForm();
      utils.agent.list.invalidate();
      utils.agent.getWorkspaceAgentStats.invalidate();
    },
  });

  const _updateAgent = api.agent.update.useMutation({
    onSuccess: () => {
      setEditingAgentId(null);
      utils.agent.list.invalidate();
    },
  });

  const resetForm = () => {
    setNewAgentName("");
    setNewAgentEmail("");
    setNewAgentConfig(defaultConfig);
    setSelectedColor(0);
  };

  const handleCreateAgent = () => {
    if (!workspaceId || !newAgentName.trim() || !newAgentEmail.trim()) return;

    const colors = AVATAR_COLORS[selectedColor] ?? AVATAR_COLORS[0];
    createAgent.mutate({
      workspaceId,
      name: newAgentName.trim(),
      email: newAgentEmail.trim(),
      config: {
        ...newAgentConfig,
        avatar: {
          primaryColor: colors!.primary,
          accentColor: colors!.accent,
          variant: "default",
        },
      },
    });
  };

  const toggleCapability = (capability: string) => {
    setNewAgentConfig((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability],
    }));
  };

  const toggleProject = (projectId: string) => {
    setNewAgentConfig((prev) => ({
      ...prev,
      allowedProjects: prev.allowedProjects.includes(projectId)
        ? prev.allowedProjects.filter((p) => p !== projectId)
        : [...prev.allowedProjects, projectId],
    }));
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
                Select a workspace in the Workspaces tab to manage AI agents.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Agents
              </CardTitle>
              <CardDescription>
                Configure AI agents that can autonomously work on tasks.
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateAgent(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Agent
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {stats && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Activity className="h-4 w-4" />
                  Active Now
                </div>
                <p className="text-2xl font-bold text-green-600">{stats.activeNow}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Check className="h-4 w-4" />
                  Completed
                </div>
                <p className="text-2xl font-bold text-blue-600">{stats.totalCompleted}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <AlertCircle className="h-4 w-4" />
                  Failed
                </div>
                <p className="text-2xl font-bold text-red-600">{stats.totalFailed}</p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : agents && agents.length > 0 ? (
            <div className="space-y-3">
              {agents.map((agent) => {
                const agentConfig = agent.agentConfig as AgentConfig | null;
                const isExpanded = expandedAgentId === agent.id;
                const agentStats = stats?.agents.find((a) => a.id === agent.id);

                return (
                  <div key={agent.id} className="rounded-lg border">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedAgentId(isExpanded ? null : agent.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          className="h-10 w-10"
                          style={{
                            backgroundColor: agentConfig?.avatar?.primaryColor ?? "#6366f1",
                          }}
                        >
                          <AvatarFallback className="text-white font-bold">
                            {agent.name?.[0]?.toUpperCase() ?? "A"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{agent.name}</p>
                            {agentStats?.isActive && (
                              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/50">
                                <CircleDot className="mr-1 h-3 w-3 animate-pulse" />
                                Working
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{agent.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm text-muted-foreground">
                          <p>{agentStats?.completed ?? 0} completed</p>
                          <p>{agentStats?.inProgress ?? 0} in progress</p>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t p-4 bg-muted/30">
                        <div className="grid gap-4">
                          <div>
                            <p className="text-sm font-medium mb-2">Capabilities</p>
                            <div className="flex flex-wrap gap-2">
                              {agentConfig?.capabilities?.length ? (
                                agentConfig.capabilities.map((cap) => (
                                  <Badge key={cap} variant="secondary">
                                    {CAPABILITY_OPTIONS.find((c) => c.id === cap)?.label ?? cap}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-sm text-muted-foreground">No capabilities configured</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="text-sm font-medium mb-2">Settings</p>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Max concurrent tasks:</span>
                                <span>{agentConfig?.maxConcurrentTasks ?? 1}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Auto-claim:</span>
                                <span>{agentConfig?.autoClaimEnabled ? "Enabled" : "Disabled"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Allowed projects:</span>
                                <span>{agentConfig?.allowedProjects?.length ?? 0} projects</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="mx-auto h-12 w-12 opacity-50 mb-4" />
              <p>No AI agents configured</p>
              <p className="text-sm">Create an agent to automate task completion</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How Agents Work</CardTitle>
          <CardDescription>
            AI agents can autonomously claim and complete tasks in your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-5 w-5 text-blue-500" />
                <p className="font-medium">Claim Tasks</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Agents can claim unassigned tasks that match their configured capabilities and allowed projects.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <p className="font-medium">Work Autonomously</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Agents report progress, create commits/PRs, and update task status as they work.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-5 w-5 text-green-500" />
                <p className="font-medium">Hand Off When Stuck</p>
              </div>
              <p className="text-sm text-muted-foreground">
                If an agent can&apos;t complete a task, it hands off to a human with context about what was tried.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {showCreateAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Create AI Agent</CardTitle>
              <CardDescription>
                Configure a new AI agent for your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="agent-name">Agent Name</Label>
                  <Input
                    id="agent-name"
                    placeholder="e.g., Claude Code Agent"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="agent-email">Agent Email</Label>
                  <Input
                    id="agent-email"
                    type="email"
                    placeholder="e.g., agent@your-domain.com"
                    value={newAgentEmail}
                    onChange={(e) => setNewAgentEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to identify the agent in activity logs
                  </p>
                </div>
              </div>

              <Separator />

              <div>
                <Label className="mb-3 block">Avatar Color</Label>
                <div className="flex gap-2">
                  {AVATAR_COLORS.map((color, index) => (
                    <button
                      key={index}
                      className={`h-10 w-10 rounded-full transition-all ${
                        selectedColor === index ? "ring-2 ring-offset-2 ring-primary" : ""
                      }`}
                      style={{ backgroundColor: color.primary }}
                      onClick={() => setSelectedColor(index)}
                    />
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="mb-3 block">Capabilities</Label>
                <div className="space-y-2">
                  {CAPABILITY_OPTIONS.map((cap) => (
                    <div
                      key={cap.id}
                      className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                        newAgentConfig.capabilities.includes(cap.id)
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleCapability(cap.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={newAgentConfig.capabilities.includes(cap.id)}
                          onCheckedChange={() => toggleCapability(cap.id)}
                        />
                        <div>
                          <p className="font-medium">{cap.label}</p>
                          <p className="text-sm text-muted-foreground">{cap.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="mb-3 block">Allowed Projects</Label>
                {projects && projects.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {projects.map(({ project }) => (
                      <div
                        key={project.id}
                        className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                          newAgentConfig.allowedProjects.includes(project.id)
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => toggleProject(project.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={newAgentConfig.allowedProjects.includes(project.id)}
                            onCheckedChange={() => toggleProject(project.id)}
                          />
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: project.color ?? "#6366f1" }}
                          />
                          <span>{project.name}</span>
                        </div>
                        <Badge variant="outline">{project.key}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No projects available. Agent will have access to all projects.
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Leave empty to allow agent to work on all projects
                </p>
              </div>

              <Separator />

              <div>
                <Label className="mb-3 block">Settings</Label>
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="max-tasks">Max Concurrent Tasks</Label>
                    <Input
                      id="max-tasks"
                      type="number"
                      min={1}
                      max={10}
                      value={newAgentConfig.maxConcurrentTasks}
                      onChange={(e) =>
                        setNewAgentConfig((prev) => ({
                          ...prev,
                          maxConcurrentTasks: parseInt(e.target.value) || 1,
                        }))
                      }
                    />
                  </div>

                  <div
                    className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                      newAgentConfig.autoClaimEnabled ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() =>
                      setNewAgentConfig((prev) => ({
                        ...prev,
                        autoClaimEnabled: !prev.autoClaimEnabled,
                      }))
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={newAgentConfig.autoClaimEnabled}
                        onCheckedChange={(checked) =>
                          setNewAgentConfig((prev) => ({
                            ...prev,
                            autoClaimEnabled: checked === true,
                          }))
                        }
                      />
                      <div>
                        <p className="font-medium">Auto-claim tasks</p>
                        <p className="text-sm text-muted-foreground">
                          Automatically claim matching unassigned tasks
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
            <div className="flex justify-end gap-2 p-6 pt-0">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateAgent(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateAgent}
                disabled={!newAgentName.trim() || !newAgentEmail.trim() || createAgent.isPending}
              >
                {createAgent.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Agent"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

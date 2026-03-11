"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Avatar,
  AvatarFallback,
} from "@linear-clone/ui";
import {
  Bot,
  Activity,
  Check,
  AlertCircle,
  Loader2,
  ChevronRight,
  CircleDot,
  Clock,
  Target,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";

type AgentTaskRunStatus = "claimed" | "in_progress" | "completed" | "failed" | "abandoned" | "handed_off";

const statusColors: Record<AgentTaskRunStatus, { bg: string; text: string; border: string }> = {
  claimed: { bg: "bg-blue-500/10", text: "text-blue-600", border: "border-blue-500/30" },
  in_progress: { bg: "bg-yellow-500/10", text: "text-yellow-600", border: "border-yellow-500/30" },
  completed: { bg: "bg-green-500/10", text: "text-green-600", border: "border-green-500/30" },
  failed: { bg: "bg-red-500/10", text: "text-red-600", border: "border-red-500/30" },
  abandoned: { bg: "bg-gray-500/10", text: "text-gray-600", border: "border-gray-500/30" },
  handed_off: { bg: "bg-purple-500/10", text: "text-purple-600", border: "border-purple-500/30" },
};

const statusLabels: Record<AgentTaskRunStatus, string> = {
  claimed: "Claimed",
  in_progress: "Working",
  completed: "Completed",
  failed: "Failed",
  abandoned: "Abandoned",
  handed_off: "Handed Off",
};

export default function AgentsDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: stats, isLoading } = api.agent.getWorkspaceAgentStats.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: agents } = api.agent.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: agentActivity, isLoading: isLoadingActivity } = api.agent.getAgentActivity.useQuery(
    { agentId: selectedAgentId!, limit: 20 },
    { enabled: !!selectedAgentId }
  );

  const formatTimeAgo = (date: Date | null | undefined) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const selectedAgent = selectedAgentId
    ? agents?.find((a) => a.id === selectedAgentId)
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">AI Agents</h1>
              <p className="text-sm text-muted-foreground">
                Monitor agent activity and performance
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/settings")}
          >
            Configure Agents
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Bot className="h-4 w-4" />
                    Total Agents
                  </div>
                  <p className="text-3xl font-bold">{stats?.agents.length ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Activity className="h-4 w-4 text-green-500" />
                    Active Now
                  </div>
                  <p className="text-3xl font-bold text-green-600">{stats?.activeNow ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Check className="h-4 w-4 text-blue-500" />
                    Tasks Completed
                  </div>
                  <p className="text-3xl font-bold text-blue-600">{stats?.totalCompleted ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    Failed Tasks
                  </div>
                  <p className="text-3xl font-bold text-red-600">{stats?.totalFailed ?? 0}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-5">
                <Card>
                  <CardHeader>
                    <CardTitle>Agents</CardTitle>
                    <CardDescription>
                      Select an agent to view their activity
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {agents && agents.length > 0 ? (
                      <div className="space-y-2">
                        {agents.map((agent) => {
                          const agentStats = stats?.agents.find((a) => a.id === agent.id);
                          const agentConfig = agent.agentConfig as { avatar?: { primaryColor: string } } | null;
                          const isSelected = selectedAgentId === agent.id;

                          return (
                            <div
                              key={agent.id}
                              className={cn(
                                "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                                isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                              )}
                              onClick={() => setSelectedAgentId(agent.id)}
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
                                      <CircleDot className="h-3 w-3 text-green-500 animate-pulse" />
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground">
                                    {agentStats?.completed ?? 0} completed
                                    {(agentStats?.inProgress ?? 0) > 0 && (
                                      <span className="text-yellow-600">
                                        {" "}· {agentStats?.inProgress} in progress
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Bot className="mx-auto h-12 w-12 opacity-50 mb-4" />
                        <p>No agents configured</p>
                        <Button
                          variant="link"
                          onClick={() => router.push("/dashboard/settings")}
                        >
                          Configure agents in settings
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="col-span-12 lg:col-span-7">
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>
                          {selectedAgent ? (
                            <span className="flex items-center gap-2">
                              Activity - {selectedAgent.name}
                            </span>
                          ) : (
                            "Agent Activity"
                          )}
                        </CardTitle>
                        <CardDescription>
                          {selectedAgent
                            ? "Recent task runs and progress"
                            : "Select an agent to view their activity"}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {selectedAgentId ? (
                      isLoadingActivity ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : agentActivity && agentActivity.length > 0 ? (
                        <div className="space-y-3">
                          {agentActivity.map((run) => {
                            const colors = statusColors[run.status as AgentTaskRunStatus] ?? statusColors.claimed;
                            const result = run.result as { summary?: string; error?: { message: string } } | null;

                            return (
                              <div
                                key={run.id}
                                className={cn(
                                  "rounded-lg border p-4 transition-colors hover:bg-muted/30",
                                  colors.border
                                )}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Badge className={cn(colors.bg, colors.text, "border-0")}>
                                        {statusLabels[run.status as AgentTaskRunStatus] ?? run.status}
                                      </Badge>
                                      <span className="text-sm text-muted-foreground">
                                        {formatTimeAgo(run.claimedAt)}
                                      </span>
                                    </div>

                                    {result?.summary && (
                                      <p className="text-sm text-muted-foreground mb-2">
                                        {result.summary}
                                      </p>
                                    )}

                                    {result?.error && (
                                      <p className="text-sm text-red-600">
                                        {result.error.message}
                                      </p>
                                    )}

                                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                                      {run.startedAt && (
                                        <span className="flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          Started {formatTimeAgo(run.startedAt)}
                                        </span>
                                      )}
                                      {run.completedAt && (
                                        <span className="flex items-center gap-1">
                                          <Target className="h-3 w-3" />
                                          Completed {formatTimeAgo(run.completedAt)}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      router.push(
                                        `/dashboard/${workspaceSlug}/forge/runs/${run.id}`
                                      )
                                    }
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-muted-foreground">
                          <Activity className="mx-auto h-12 w-12 opacity-50 mb-4" />
                          <p>No activity yet</p>
                          <p className="text-sm">
                            This agent hasn&apos;t worked on any tasks
                          </p>
                        </div>
                      )
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <Activity className="mx-auto h-12 w-12 opacity-50 mb-4" />
                        <p>Select an agent to view activity</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

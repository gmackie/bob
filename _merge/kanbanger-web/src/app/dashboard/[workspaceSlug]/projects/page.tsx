"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@linear-clone/ui/components/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@linear-clone/ui/components/popover";
import { ProjectCard } from "@/components/projects/project-card";
import { CreateProjectModal } from "@/components/projects/create-project-modal";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
} from "lucide-react";

type StatusFilter = "all" | "active" | "completed";
type ViewMode = "grid" | "list";
type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "canceled" | "backlog";

export default function ProjectsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceSlug = params.workspaceSlug as string;

  const [showCreateModal, setShowCreateModal] = useState(false);
  
  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setShowCreateModal(true);
      router.replace(`/dashboard/${workspaceSlug}/projects`);
    }
  }, [searchParams, workspaceSlug, router]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: teams } = api.team.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: projectGroups } = api.projectGroup.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  // Fetch projects
  const { data: projectsData, isLoading } = api.project.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const utils = api.useUtils();

  const createProjectMutation = api.project.create.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      setShowCreateModal(false);
    },
  });

  const createGroupMutation = api.projectGroup.create.useMutation({
    onSuccess: () => {
      utils.projectGroup.list.invalidate();
      setNewGroupName("");
      setIsCreatingGroup(false);
    },
  });

  const addProjectToGroupMutation = api.projectGroup.addProject.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
    },
  });

  const handleCreateProject = async (data: {
    name: string;
    description?: string;
    color?: string;
    status?: string;
    teamIds?: string[];
    createForgeRepository?: boolean;
    forgeRepositoryName?: string;
    forgeRepositoryStorageBackend?: "s3" | "rsync";
    forgeRepositoryStoragePrefix?: string;
  }) => {
    if (!workspace?.id) return;
    await createProjectMutation.mutateAsync({
      workspaceId: workspace.id,
      name: data.name,
      description: data.description,
      color: data.color,
      status: (data.status as ProjectStatus) || "planned",
      teamIds: data.teamIds,
      createForgeRepository: data.createForgeRepository,
      forgeRepositoryName: data.forgeRepositoryName,
      forgeRepositoryStorageBackend: data.forgeRepositoryStorageBackend,
      forgeRepositoryStoragePrefix: data.forgeRepositoryStoragePrefix,
    });
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace?.id || !newGroupName.trim()) return;
    
    await createGroupMutation.mutateAsync({
      workspaceId: workspace.id,
      name: newGroupName,
      color: "#6366f1", 
    });
  };

  const handleMoveProject = async (projectId: string, groupId: string | null) => {
    await addProjectToGroupMutation.mutateAsync({
      projectId,
      groupId,
    });
  };

  const toggleGroup = (groupId: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupId)) {
      newCollapsed.delete(groupId);
    } else {
      newCollapsed.add(groupId);
    }
    setCollapsedGroups(newCollapsed);
  };

  const filteredProjects = useMemo(() => {
    return projectsData?.filter((p) => {
      const project = p.project;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !project.name.toLowerCase().includes(query) &&
          !project.description?.toLowerCase().includes(query)
        ) {
          return false;
        }
      }

      if (statusFilter === "active") {
        return ["planned", "in_progress", "paused"].includes(project.status);
      }
      if (statusFilter === "completed") {
        return ["completed", "canceled"].includes(project.status);
      }

      return true;
    }) ?? [];
  }, [projectsData, searchQuery, statusFilter]);

  const groupedProjects = useMemo(() => {
    if (!projectGroups) return { groups: {}, ungrouped: filteredProjects };

    const groups: Record<string, typeof filteredProjects> = {};
    const ungrouped: typeof filteredProjects = [];

    projectGroups.forEach(g => {
      groups[g.id] = [];
    });

    filteredProjects.forEach(p => {
      if (p.project.groupId && groups[p.project.groupId]) {
        groups[p.project.groupId]!.push(p);
      } else {
        ungrouped.push(p);
      }
    });

    return { groups, ungrouped };
  }, [filteredProjects, projectGroups]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">Projects</h1>
            <Tabs
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-64 pl-8"
              />
            </div>
            <div className="flex items-center rounded-md border border-border">
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-none rounded-l-md ${viewMode === "grid" ? "bg-muted" : ""}`}
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-none rounded-r-md ${viewMode === "list" ? "bg-muted" : ""}`}
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            
            <Popover open={isCreatingGroup} onOpenChange={setIsCreatingGroup}>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <FolderPlus className="mr-1 h-4 w-4" />
                  New group
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <form onSubmit={handleCreateGroup} className="space-y-4">
                  <h4 className="font-medium leading-none">Create Project Group</h4>
                  <div className="space-y-2">
                    <Input 
                      placeholder="Group name" 
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={!newGroupName.trim() || createGroupMutation.isPending}>
                      Create Group
                    </Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>

            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-1 h-4 w-4" />
              New project
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredProjects.length > 0 ? (
          <div className="space-y-8">
            {projectGroups?.map((group) => {
              const projects = groupedProjects.groups[group.id] || [];
              const isCollapsed = collapsedGroups.has(group.id);
              
              return (
                <Collapsible
                  key={group.id}
                  open={!isCollapsed}
                  onOpenChange={() => toggleGroup(group.id)}
                  className="space-y-3"
                >
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                    <div className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground group-hover:bg-muted">
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color ?? "#6366f1" }} />
                      {group.name}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {projects.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div
                      className={
                        viewMode === "grid"
                          ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pl-7"
                          : "space-y-2 pl-7"
                      }
                    >
                      {projects.map((p) => (
                        <div key={p.project.id} className="group relative">
                          <ProjectCard
                            project={{
                              id: p.project.id,
                              name: p.project.name,
                              description: p.project.description,
                              color: p.project.color,
                              status: p.project.status,
                              issueCount: p.issueCount,
                              completedCount: p.completedCount,
                              leadUser: p.lead,
                              teams: p.teams,
                            }}
                            onClick={() =>
                              router.push(`/dashboard/${workspaceSlug}/projects/${p.project.id}`)
                            }
                          />
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="secondary" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                  <MoreHorizontal className="h-3 w-3" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-48 p-1">
                                <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Move to group</div>
                                <div className="space-y-0.5">
                                  <button 
                                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm flex items-center gap-2"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMoveProject(p.project.id, null);
                                    }}
                                  >
                                    <span className="h-2 w-2 rounded-full border border-muted-foreground" />
                                    Ungrouped
                                  </button>
                                  {projectGroups.filter(g => g.id !== group.id).map(g => (
                                    <button
                                      key={g.id}
                                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm flex items-center gap-2"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMoveProject(p.project.id, g.id);
                                      }}
                                    >
                                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color ?? "#6366f1" }} />
                                      {g.name}
                                    </button>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>
                      ))}
                      {projects.length === 0 && (
                        <div className="col-span-full py-4 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                          No projects in this group
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            {(groupedProjects.ungrouped.length > 0 || (!projectGroups || projectGroups.length === 0)) && (
              <div className="space-y-3">
                 {projectGroups && projectGroups.length > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
                     <div className="flex h-5 w-5 items-center justify-center">
                       <ChevronDown className="h-4 w-4 opacity-50" /> 
                     </div>
                     <span>Ungrouped</span>
                     <span className="ml-1 text-xs text-muted-foreground">
                        {groupedProjects.ungrouped.length}
                     </span>
                  </div>
                 )}
                 <div
                    className={
                      viewMode === "grid"
                        ? `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${projectGroups && projectGroups.length > 0 ? "pl-7" : ""}`
                        : `space-y-2 ${projectGroups && projectGroups.length > 0 ? "pl-7" : ""}`
                    }
                 >
                    {groupedProjects.ungrouped.map((p) => (
                       <div key={p.project.id} className="group relative">
                          <ProjectCard
                            project={{
                              id: p.project.id,
                              name: p.project.name,
                              description: p.project.description,
                              color: p.project.color,
                              status: p.project.status,
                              issueCount: p.issueCount,
                              completedCount: p.completedCount,
                              leadUser: p.lead,
                              teams: p.teams,
                            }}
                            onClick={() =>
                              router.push(`/dashboard/${workspaceSlug}/projects/${p.project.id}`)
                            }
                          />
                          {projectGroups && projectGroups.length > 0 && (
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="secondary" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-3 w-3" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-48 p-1">
                                  <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Move to group</div>
                                  <div className="space-y-0.5">
                                    {projectGroups.map(g => (
                                      <button
                                        key={g.id}
                                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm flex items-center gap-2"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleMoveProject(p.project.id, g.id);
                                        }}
                                      >
                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color ?? "#6366f1" }} />
                                        {g.name}
                                      </button>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                          )}
                       </div>
                    ))}
                 </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <p className="text-muted-foreground">
              {searchQuery
                ? "No projects match your search"
                : statusFilter === "active"
                  ? "No active projects"
                  : statusFilter === "completed"
                    ? "No completed projects"
                    : "No projects yet"}
            </p>
            {!searchQuery && (
              <Button
                variant="link"
                onClick={() => setShowCreateModal(true)}
              >
                Create your first project
              </Button>
            )}
          </div>
        )}
      </div>

      {showCreateModal && workspace && (
        <CreateProjectModal
          workspaceId={workspace.id}
          teams={teams ?? []}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateProject}
        />
      )}
    </div>
  );
}

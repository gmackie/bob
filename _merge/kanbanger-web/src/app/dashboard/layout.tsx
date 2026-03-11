"use client";

import type { ReactNode } from "react";
import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Settings,
  LogOut,
  CheckSquare,
  Folder,
  Plus,
  Kanban,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  LayoutGrid,
  Star,
  FileText,
  Inbox,
  Map,
  Home,
  Lightbulb,
} from "lucide-react";
import { Button } from "@linear-clone/ui/components/button";
import { Avatar, AvatarFallback } from "@linear-clone/ui/components/avatar";
import { api } from "@/lib/trpc/client";
import { cn } from "@linear-clone/ui/lib/utils";
import { CreateProjectModal } from "@/components/projects/create-project-modal";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command-palette";
import { KeyboardShortcutsHelp } from "@/components/keyboard-shortcuts-help";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";

function UserMenu() {
  const { data: user } = api.user.me.useQuery();

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="text-xs">
          {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "U"}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm truncate flex-1">{user?.name ?? user?.email ?? "User"}</span>
      <form action="/api/auth/logout" method="POST">
        <Button variant="ghost" size="icon" className="h-7 w-7" type="submit">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}

function NavItem({
  href,
  icon: Icon,
  children,
  active,
}: {
  href: string;
  icon: typeof CheckSquare;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
        active
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{children}</span>
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showCreateProject, setShowCreateProject] = useState(false);

  const { data: workspaces, isLoading } = api.workspace.list.useQuery();
  const workspace = workspaces?.[0]?.workspace;
  const workspaceSlug = workspace?.slug;

  const { data: projectsData } = api.project.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );
  const projects = useMemo(() => projectsData?.map((p) => p.project) ?? [], [projectsData]);

  const { data: projectGroups } = api.projectGroup.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { groupedProjects, ungroupedProjects } = useMemo(() => {
    if (!projectGroups) return { groupedProjects: [], ungroupedProjects: projects };
    
    const grouped = projectGroups.map((group) => ({
      group,
      projects: projects.filter((p) => p.groupId === group.id),
    }));

    const ungrouped = projects.filter((p) => !p.groupId);

    return { groupedProjects: grouped, ungroupedProjects: ungrouped };
  }, [projects, projectGroups]);

  const toggleGroup = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const { data: favorites } = api.favorite.list.useQuery(
    { workspaceId: workspace?.id },
    { enabled: !!workspace?.id }
  );

  const { data: viewsData } = api.view.list.useQuery(
    { workspaceId: workspace?.id ?? "", includeShared: true },
    { enabled: !!workspace?.id }
  );

  const { data: unreadCount } = api.notification.unreadCount.useQuery();

  const utils = api.useUtils();

  const createProjectMutation = api.project.create.useMutation({
    onSuccess: (newProject) => {
      utils.project.list.invalidate();
      setShowCreateProject(false);
      if (workspaceSlug && newProject.id) {
        router.push(`/dashboard/${workspaceSlug}/projects/${newProject.id}`);
      }
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
      status: (data.status as "planned" | "in_progress" | "paused" | "completed" | "canceled" | "backlog") ?? "planned",
      createForgeRepository: data.createForgeRepository,
      forgeRepositoryName: data.forgeRepositoryName,
      forgeRepositoryStorageBackend: data.forgeRepositoryStorageBackend,
      forgeRepositoryStoragePrefix: data.forgeRepositoryStoragePrefix,
      teamIds: data.teamIds,
    });
  };

  const baseUrl = workspaceSlug ? `/dashboard/${workspaceSlug}` : "/dashboard";

  const { chordMode } = useGlobalShortcuts(workspaceSlug);

  return (
    <div className="flex h-screen w-full bg-background">
      <aside className="flex w-56 flex-col border-r bg-muted/20">
        <div className="flex h-12 items-center gap-2 border-b px-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-600">
              <CheckSquare className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm">Tasks</span>
          </Link>
        </div>

        <div className="px-2 pt-2">
          <CommandPaletteTrigger />
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {workspaceSlug && (
            <>
              <NavItem
                href={`${baseUrl}/home`}
                icon={Home}
                active={pathname === `${baseUrl}/home`}
              >
                Home
              </NavItem>
              <NavItem
                href={`${baseUrl}/tasks/ideas`}
                icon={Lightbulb}
                active={pathname === `${baseUrl}/tasks/ideas`}
              >
                Ideas
              </NavItem>
              <NavItem
                href={`${baseUrl}/tasks/my`}
                icon={Star}
                active={pathname === `${baseUrl}/tasks/my`}
              >
                My Tasks
              </NavItem>
              <NavItem
                href={`${baseUrl}/tasks/all`}
                icon={Kanban}
                active={pathname === `${baseUrl}/tasks/all`}
              >
                All Issues
              </NavItem>
              <NavItem
                href={`${baseUrl}/tasks/stale`}
                icon={Clock}
                active={pathname === `${baseUrl}/tasks/stale`}
              >
                Stale
              </NavItem>
              <NavItem
                href={`${baseUrl}/cycles`}
                icon={RefreshCw}
                active={pathname.startsWith(`${baseUrl}/cycles`)}
              >
                Cycles
              </NavItem>
              <NavItem
                href={`${baseUrl}/views`}
                icon={LayoutGrid}
                active={pathname.startsWith(`${baseUrl}/views`)}
              >
                Views
              </NavItem>
              <NavItem
                href={`${baseUrl}/roadmap`}
                icon={Map}
                active={pathname.startsWith(`${baseUrl}/roadmap`)}
              >
                Roadmap
              </NavItem>

              <div className="relative">
                <NavItem
                  href={`${baseUrl}/inbox`}
                  icon={Inbox}
                  active={pathname.startsWith(`${baseUrl}/inbox`)}
                >
                  Inbox
                </NavItem>
                {unreadCount && unreadCount > 0 && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>

              {favorites && favorites.length > 0 && (
                <div className="pt-4">
                  <div className="flex items-center px-2 mb-1">
                    <button
                      type="button"
                      onClick={() => setFavoritesExpanded(!favoritesExpanded)}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {favoritesExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <Star className="h-3 w-3 mr-0.5" />
                      <span>Favorites</span>
                    </button>
                  </div>

                  {favoritesExpanded && (
                    <div className="space-y-0.5">
                      {favorites.map((fav) => {
                        if (fav.projectId) {
                          const project = projects.find((p) => p.id === fav.projectId);
                          if (!project) return null;
                          const projectUrl = `${baseUrl}/projects/${project.id}`;
                          const isActive = pathname.startsWith(projectUrl);
                          return (
                            <Link
                              key={fav.id}
                              href={projectUrl}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                                isActive
                                  ? "bg-muted text-foreground font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: project.color ?? "#6366f1" }}
                              />
                              <span className="truncate flex-1">{project.name}</span>
                            </Link>
                          );
                        }
                        if (fav.customViewId) {
                          const view = viewsData?.find((v) => v.id === fav.customViewId);
                          if (!view) return null;
                          const viewUrl = `${baseUrl}/views/${view.id}`;
                          const isActive = pathname === viewUrl;
                          return (
                            <Link
                              key={fav.id}
                              href={viewUrl}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                                isActive
                                  ? "bg-muted text-foreground font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <LayoutGrid
                                className="h-3 w-3 flex-shrink-0"
                                style={{ color: view.color ?? "#6366f1" }}
                              />
                              <span className="truncate flex-1">{view.name}</span>
                            </Link>
                          );
                        }
                        if (fav.issueId) {
                          return (
                            <div
                              key={fav.id}
                              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground"
                            >
                              <FileText className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate flex-1">Issue</span>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4">
                <div className="flex items-center justify-between px-2 mb-1">
                  <button
                    type="button"
                    onClick={() => setProjectsExpanded(!projectsExpanded)}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {projectsExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span>Projects</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setShowCreateProject(true)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                {projectsExpanded && (
                  <div className="space-y-0.5">
                    {projects.length === 0 && (
                      <p className="px-2.5 py-2 text-xs text-muted-foreground">
                        No projects yet
                      </p>
                    )}

                    {ungroupedProjects.map((project) => {
                      const projectUrl = `${baseUrl}/projects/${project.id}`;
                      const isActive = pathname.startsWith(projectUrl);
                      return (
                        <Link
                          key={project.id}
                          href={projectUrl}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                            isActive
                              ? "bg-muted text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: project.color ?? "#6366f1" }}
                          />
                          <span className="truncate flex-1">{project.name}</span>
                          {project.key && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {project.key}
                            </span>
                          )}
                        </Link>
                      );
                    })}

                    {groupedProjects.map(({ group, projects }) => {
                      if (projects.length === 0) return null;
                      const isCollapsed = collapsedGroups.has(group.id);
                      
                      return (
                        <div key={group.id} className="pt-1">
                          <button
                            onClick={(e) => toggleGroup(e, group.id)}
                            className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group"
                          >
                            <span className="flex h-3 w-3 items-center justify-center">
                              {isCollapsed ? (
                                <ChevronRight className="h-2.5 w-2.5" />
                              ) : (
                                <ChevronDown className="h-2.5 w-2.5" />
                              )}
                            </span>
                            {group.color && (
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: group.color }}
                              />
                            )}
                            <span className="truncate">{group.name}</span>
                          </button>
                          
                          {!isCollapsed && (
                            <div className="mt-0.5 space-y-0.5">
                              {projects.map((project) => {
                                const projectUrl = `${baseUrl}/projects/${project.id}`;
                                const isActive = pathname.startsWith(projectUrl);
                                return (
                                  <Link
                                    key={project.id}
                                    href={projectUrl}
                                    className={cn(
                                      "flex items-center gap-2 rounded-md pl-6 pr-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                                      isActive
                                        ? "bg-muted text-foreground font-medium"
                                        : "text-muted-foreground hover:text-foreground"
                                    )}
                                  >
                                    <span
                                      className="h-2 w-2 rounded-sm flex-shrink-0"
                                      style={{ backgroundColor: project.color ?? "#6366f1" }}
                                    />
                                    <span className="truncate flex-1">{project.name}</span>
                                    {project.key && (
                                      <span className="text-[10px] text-muted-foreground font-mono">
                                        {project.key}
                                      </span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <Link
                      href={`${baseUrl}/projects`}
                      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted mt-2"
                    >
                      <Folder className="h-3 w-3" />
                      View all projects
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}

          {!isLoading && !workspaceSlug && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              Loading workspace...
            </div>
          )}
        </nav>

        <div className="border-t p-2 space-y-1">
          <NavItem
            href="/dashboard/settings"
            icon={Settings}
            active={pathname === "/dashboard/settings"}
          >
            Settings
          </NavItem>
          <UserMenu />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          {children}
        </div>
      </main>

      {showCreateProject && workspace && (
        <CreateProjectModal
          workspaceId={workspace.id}
          teams={[]}
          onClose={() => setShowCreateProject(false)}
          onSubmit={handleCreateProject}
        />
      )}

      <CommandPalette workspaceSlug={workspaceSlug} />
      <KeyboardShortcutsHelp />

      {chordMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2 rounded-lg bg-background border shadow-lg px-4 py-2">
            <span className="text-sm text-muted-foreground">Press a key after</span>
            <kbd className="px-2 py-1 rounded bg-muted text-sm font-mono font-medium">
              {chordMode.toUpperCase()}
            </kbd>
          </div>
        </div>
      )}
    </div>
  );
}

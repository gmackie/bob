"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { api } from "@/lib/trpc/client";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  Search,
  Plus,
  ListTodo,
  RefreshCw,
  LayoutGrid,
  Lightbulb,
  Inbox,
  Settings,
  FileText,
  ArrowRight,
  Command,
  Home,
  FolderKanban,
  Tag,
  Users,
  Moon,
  Sun,
  Monitor,
  Keyboard,
  User,
  LogOut,
  Copy,
  ExternalLink,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  AlertCircle,
} from "lucide-react";


interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
  keywords?: string[];
  shortcut?: string;
}

type CommandMode = "default" | "search" | "create" | "theme";

interface CommandPaletteProps {
  workspaceSlug?: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  backlog: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  todo: <Circle className="h-3.5 w-3.5 text-blue-500" />,
  in_progress: <Loader2 className="h-3.5 w-3.5 text-yellow-500" />,
  in_review: <AlertCircle className="h-3.5 w-3.5 text-purple-500" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  cancelled: <XCircle className="h-3.5 w-3.5 text-muted-foreground" />,
};

export function CommandPalette({ workspaceSlug }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<CommandMode>("default");
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug ?? "" },
    { enabled: !!workspaceSlug }
  );

  const { data: projects } = api.project.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id && isOpen }
  );

  const { data: recentIssues } = api.issue.list.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      pagination: { limit: 5, offset: 0, sortBy: "updatedAt", sortDirection: "desc" },
    },
    { enabled: !!workspace?.id && isOpen && mode === "default" }
  );

  const { data: searchResults, isLoading: isSearching } = api.issue.list.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: { search: query },
      pagination: { limit: 10, offset: 0, sortBy: "updatedAt", sortDirection: "desc" },
    },
    { enabled: !!workspace?.id && isOpen && mode === "search" && query.length > 1 }
  );

  const { data: labels } = api.label.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id && isOpen }
  );

  const { data: cycles } = api.cycle.listByWorkspace.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id && isOpen }
  );

  const { data: members } = api.workspace.members.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id && isOpen }
  );

  const baseUrl = workspaceSlug ? `/dashboard/${workspaceSlug}` : "/dashboard";

  const closeAndNavigate = useCallback(
    (path: string) => {
      setIsOpen(false);
      setQuery("");
      setMode("default");
      router.push(path);
    },
    [router]
  );

  const closeAndAction = useCallback((action: () => void) => {
    setIsOpen(false);
    setQuery("");
    setMode("default");
    action();
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const commands = useMemo<CommandItem[]>(() => {
    if (mode === "theme") {
      return [
        {
          id: "theme-light",
          title: "Light",
          subtitle: theme === "light" ? "Currently active" : undefined,
          icon: <Sun className="h-4 w-4" />,
          category: "Theme",
          action: () => closeAndAction(() => setTheme("light")),
        },
        {
          id: "theme-dark",
          title: "Dark",
          subtitle: theme === "dark" ? "Currently active" : undefined,
          icon: <Moon className="h-4 w-4" />,
          category: "Theme",
          action: () => closeAndAction(() => setTheme("dark")),
        },
        {
          id: "theme-system",
          title: "System",
          subtitle: theme === "system" ? "Currently active" : undefined,
          icon: <Monitor className="h-4 w-4" />,
          category: "Theme",
          action: () => closeAndAction(() => setTheme("system")),
        },
      ];
    }

    if (mode === "search" && searchResults) {
      const items: CommandItem[] = searchResults.map((issue) => ({
        id: `search-${issue.id}`,
        title: issue.title,
        subtitle: issue.identifier,
        icon: STATUS_ICONS[issue.status] ?? <Circle className="h-3.5 w-3.5" />,
        category: "Search Results",
        action: () => closeAndNavigate(`${baseUrl}/tasks/ideas?issue=${issue.id}`),
      }));

      if (items.length === 0 && query.length > 1 && !isSearching) {
        items.push({
          id: "no-results",
          title: `No results for "${query}"`,
          subtitle: "Try a different search term",
          icon: <Search className="h-4 w-4" />,
          category: "Search Results",
          action: () => {},
        });
      }

      return items;
    }

    if (!workspaceSlug) return [];

    const items: CommandItem[] = [
      {
        id: "search-issues",
        title: "Search issues...",
        subtitle: "Find tasks by title or identifier",
        icon: <Search className="h-4 w-4" />,
        category: "Quick Actions",
        action: () => setMode("search"),
        keywords: ["search", "find", "issues", "tasks"],
        shortcut: "/",
      },
      {
        id: "new-task",
        title: "Create new task",
        icon: <Plus className="h-4 w-4" />,
        category: "Quick Actions",
        action: () => closeAndNavigate(`${baseUrl}/tasks/all?new=true`),
        keywords: ["add", "create", "task", "issue"],
        shortcut: "C",
      },
      {
        id: "new-project",
        title: "Create new project",
        icon: <FolderKanban className="h-4 w-4" />,
        category: "Quick Actions",
        action: () => closeAndNavigate(`${baseUrl}/projects?new=true`),
        keywords: ["add", "create", "project"],
      },
      {
        id: "change-theme",
        title: "Change theme...",
        subtitle: `Current: ${theme ?? "system"}`,
        icon: theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />,
        category: "Quick Actions",
        action: () => setMode("theme"),
        keywords: ["theme", "dark", "light", "mode", "appearance"],
      },
      {
        id: "home",
        title: "Home",
        subtitle: "Dashboard overview",
        icon: <Home className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/home`),
        keywords: ["home", "dashboard", "overview"],
        shortcut: "G H",
      },
      {
        id: "inbox",
        title: "Inbox",
        subtitle: "Notifications",
        icon: <Inbox className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/inbox`),
        keywords: ["inbox", "notifications"],
        shortcut: "G I",
      },
      {
        id: "my-tasks",
        title: "My Tasks",
        subtitle: "View tasks assigned to you",
        icon: <User className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/tasks/my`),
        keywords: ["my", "assigned", "tasks"],
        shortcut: "G M",
      },
      {
        id: "all-tasks",
        title: "All Tasks",
        icon: <ListTodo className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/tasks/all`),
        keywords: ["all", "tasks", "issues"],
        shortcut: "G A",
      },
      {
        id: "ideas",
        title: "Ideas Funnel",
        subtitle: "Monitor left-of-funnel docs and initiatives",
        icon: <Lightbulb className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/tasks/ideas`),
        keywords: ["ideas", "funnel", "brd", "requirements", "spec"],
        shortcut: "G F",
      },
      {
        id: "projects",
        title: "Projects",
        subtitle: "View all projects",
        icon: <FolderKanban className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/projects`),
        keywords: ["projects", "list"],
        shortcut: "G P",
      },
      {
        id: "cycles",
        title: "Cycles",
        subtitle: "View sprints and cycles",
        icon: <RefreshCw className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/cycles`),
        keywords: ["cycles", "sprints"],
      },
      {
        id: "views",
        title: "Views",
        subtitle: "Custom filtered views",
        icon: <LayoutGrid className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate(`${baseUrl}/views`),
        keywords: ["views", "filters", "saved"],
        shortcut: "G V",
      },
      {
        id: "settings",
        title: "Settings",
        icon: <Settings className="h-4 w-4" />,
        category: "Navigation",
        action: () => closeAndNavigate("/dashboard/settings"),
        keywords: ["settings", "preferences", "config"],
        shortcut: "G S",
      },
      {
        id: "keyboard-shortcuts",
        title: "Keyboard shortcuts",
        subtitle: "View all shortcuts",
        icon: <Keyboard className="h-4 w-4" />,
        category: "Help",
        action: () => closeAndNavigate(`${baseUrl}/settings/shortcuts`),
        keywords: ["keyboard", "shortcuts", "hotkeys", "help"],
        shortcut: "?",
      },
    ];

    if (projects) {
      projects.forEach((p) => {
        items.push({
          id: `project-${p.project.id}`,
          title: p.project.name,
          subtitle: `Project - ${p.project.key ?? ""}`,
          icon: (
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: p.project.color ?? "#6366f1" }}
            />
          ),
          category: "Projects",
          action: () => closeAndNavigate(`${baseUrl}/projects/${p.project.id}`),
          keywords: [p.project.name.toLowerCase(), p.project.key?.toLowerCase() ?? ""],
        });
      });
    }

    if (cycles && cycles.length > 0) {
      const activeCycles = cycles.filter((c) => c.status === "active").slice(0, 3);
      activeCycles.forEach((cycle) => {
        const cycleName = cycle.name ?? `Cycle ${cycle.number ?? ""}`;
        items.push({
          id: `cycle-${cycle.id}`,
          title: cycleName,
          subtitle: "Active Cycle",
          icon: <RefreshCw className="h-4 w-4 text-green-500" />,
          category: "Active Cycles",
          action: () => closeAndNavigate(`${baseUrl}/cycles/${cycle.id}`),
          keywords: [cycleName.toLowerCase(), "cycle", "sprint"],
        });
      });
    }

    if (labels && labels.length > 0) {
      labels.slice(0, 5).forEach((label) => {
        items.push({
          id: `label-${label.id}`,
          title: label.name,
          subtitle: "Filter by label",
          icon: (
            <Tag
              className="h-3.5 w-3.5"
              style={{ color: label.color ?? "#6366f1" }}
            />
          ),
          category: "Labels",
          action: () => closeAndNavigate(`${baseUrl}/tasks/all?label=${label.id}`),
          keywords: [label.name.toLowerCase(), "label", "tag"],
        });
      });
    }

    if (members && members.length > 0) {
      members.slice(0, 5).forEach((member) => {
        items.push({
          id: `member-${member.user.id}`,
          title: member.user.name ?? member.user.email,
          subtitle: "View assigned tasks",
          icon: <Users className="h-4 w-4" />,
          category: "Team Members",
          action: () => closeAndNavigate(`${baseUrl}/tasks/all?assignee=${member.user.id}`),
          keywords: [
            member.user.name?.toLowerCase() ?? "",
            member.user.email.toLowerCase(),
            "member",
            "assignee",
          ],
        });
      });
    }

    if (recentIssues) {
      recentIssues.forEach((issue) => {
        items.push({
          id: `issue-${issue.id}`,
          title: issue.title,
          subtitle: issue.identifier,
          icon: STATUS_ICONS[issue.status] ?? <FileText className="h-4 w-4" />,
          category: "Recent Issues",
          action: () => closeAndNavigate(`${baseUrl}/tasks/ideas?issue=${issue.id}`),
          keywords: [issue.identifier.toLowerCase(), issue.title.toLowerCase()],
        });
      });
    }

    items.push(
      {
        id: "copy-url",
        title: "Copy current URL",
        icon: <Copy className="h-4 w-4" />,
        category: "Utilities",
        action: () => closeAndAction(() => copyToClipboard(window.location.href)),
        keywords: ["copy", "url", "link", "share"],
      },
      {
        id: "open-docs",
        title: "Open documentation",
        icon: <ExternalLink className="h-4 w-4" />,
        category: "Help",
        action: () => closeAndAction(() => window.open("https://docs.linear.app", "_blank")),
        keywords: ["docs", "documentation", "help", "guide"],
      },
      {
        id: "sign-out",
        title: "Sign out",
        icon: <LogOut className="h-4 w-4" />,
        category: "Account",
        action: () => closeAndNavigate("/auth/logout"),
        keywords: ["logout", "sign out", "exit"],
      }
    );

    return items;
  }, [
    mode,
    theme,
    searchResults,
    isSearching,
    query,
    workspaceSlug,
    projects,
    cycles,
    labels,
    members,
    recentIssues,
    baseUrl,
    closeAndNavigate,
    closeAndAction,
    setTheme,
    copyToClipboard,
  ]);

  const filteredCommands = useMemo(() => {
    if (!query) return commands;

    const lowerQuery = query.toLowerCase();
    return commands.filter((cmd) => {
      if (cmd.title.toLowerCase().includes(lowerQuery)) return true;
      if (cmd.subtitle?.toLowerCase().includes(lowerQuery)) return true;
      if (cmd.keywords?.some((k) => k.includes(lowerQuery))) return true;
      return false;
    });
  }, [commands, query]);

  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category]!.push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
        setMode("default");
      }

      if (e.key === "Escape") {
        if (mode !== "default") {
          setMode("default");
          setQuery("");
        } else {
          setIsOpen(false);
          setQuery("");
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mode]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          cmd.action();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          setIsOpen(false);
          setQuery("");
        }}
      />

      <div className="relative mx-auto mt-[15vh] w-full max-w-xl">
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            {mode !== "default" && (
              <button
                type="button"
                onClick={() => {
                  setMode("default");
                  setQuery("");
                }}
                className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80"
              >
                <ArrowRight className="h-3 w-3 rotate-180" />
                {mode === "search" && "Search"}
                {mode === "theme" && "Theme"}
              </button>
            )}
            {mode === "search" && isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-4 w-4 text-muted-foreground" />
            )}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === "search"
                  ? "Search issues..."
                  : mode === "theme"
                    ? "Select a theme..."
                    : "Search or type a command..."
              }
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
              ESC
            </kbd>
          </div>

          <div className="max-h-[50vh] overflow-y-auto p-2">
            {filteredCommands.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No results found for &quot;{query}&quot;
              </div>
            ) : (
              Object.entries(groupedCommands).map(([category, items]) => (
                <div key={category} className="mb-2">
                  <div className="mb-1 px-2 py-1 text-xs font-medium text-muted-foreground">
                    {category}
                  </div>
                  {items.map((cmd) => {
                    const index = filteredCommands.indexOf(cmd);
                    const isSelected = index === selectedIndex;

                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                            isSelected ? "bg-primary-foreground/20" : "bg-muted"
                          )}
                        >
                          {cmd.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{cmd.title}</div>
                          {cmd.subtitle && (
                            <div
                              className={cn(
                                "truncate text-xs",
                                isSelected
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              )}
                            >
                              {cmd.subtitle}
                            </div>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <kbd
                            className={cn(
                              "hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:inline-block",
                              isSelected
                                ? "border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground"
                                : "border-border bg-muted text-muted-foreground"
                            )}
                          >
                            {cmd.shortcut}
                          </kbd>
                        )}
                        {isSelected && (
                          <ArrowRight className="h-4 w-4 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5">
                  <ArrowRight className="h-2.5 w-2.5 rotate-[-90deg]" />
                </kbd>
                <kbd className="rounded border border-border bg-muted px-1 py-0.5">
                  <ArrowRight className="h-2.5 w-2.5 rotate-90" />
                </kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5">Enter</kbd>
                to select
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Command className="h-3 w-3" />
              <span>K to toggle</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => {
        const event = new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        });
        document.dispatchEvent(event);
      }}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search...</span>
      <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">
        <Command className="inline h-2.5 w-2.5" />K
      </kbd>
    </button>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@linear-clone/ui/components/popover";
import { Badge } from "@linear-clone/ui/components/badge";
import { Checkbox } from "@linear-clone/ui/components/checkbox";
import {
  Search,
  X,
  User,
  FolderKanban,
  Tag,
  Calendar,
} from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";

export interface KanbanFilters {
  search: string;
  projectIds: string[];
  assigneeIds: string[];
  labelIds: string[];
  dueDateFilter: "all" | "overdue" | "next7d" | "none";
  myIssuesOnly: boolean;
}

interface Project {
  id: string;
  name: string;
  color: string | null;
}

interface UserItem {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

interface LabelItem {
  id: string;
  name: string;
  color: string;
}

interface KanbanFilterToolbarProps {
  filters: KanbanFilters;
  onFiltersChange: (filters: KanbanFilters) => void;
  projects: Project[];
  users: UserItem[];
  labels: LabelItem[];
  currentUserId?: string;
}

export function KanbanFilterToolbar({
  filters,
  onFiltersChange,
  projects,
  users,
  labels,
  currentUserId: _currentUserId,
}: KanbanFilterToolbarProps) {
  const [_searchOpen, _setSearchOpen] = useState(false);

  const activeFilterCount =
    filters.projectIds.length +
    filters.assigneeIds.length +
    filters.labelIds.length +
    (filters.dueDateFilter !== "all" ? 1 : 0);

  const updateFilter = <K extends keyof KanbanFilters>(
    key: K,
    value: KanbanFilters[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleArrayFilter = (
    key: "projectIds" | "assigneeIds" | "labelIds",
    id: string
  ) => {
    const current = filters[key];
    const updated = current.includes(id)
      ? current.filter((i) => i !== id)
      : [...current, id];
    updateFilter(key, updated);
  };

  const clearAllFilters = () => {
    onFiltersChange({
      search: "",
      projectIds: [],
      assigneeIds: [],
      labelIds: [],
      dueDateFilter: "all",
      myIssuesOnly: false,
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        <Button
          variant={filters.myIssuesOnly ? "default" : "outline"}
          size="sm"
          onClick={() => updateFilter("myIssuesOnly", !filters.myIssuesOnly)}
        >
          <User className="h-3 w-3 mr-1" />
          My Issues
        </Button>

        <div className="h-4 w-px bg-border" />
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          value={filters.search}
          onChange={(e) => updateFilter("search", e.target.value)}
          className="h-8 w-[200px] pl-8 text-sm"
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <FolderKanban className="h-3 w-3 mr-1" />
            Project
            {filters.projectIds.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {filters.projectIds.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => toggleArrayFilter("projectIds", project.id)}
              >
                <Checkbox
                  checked={filters.projectIds.includes(project.id)}
                  className="pointer-events-none"
                />
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: project.color ?? "#6366f1" }}
                />
                <span className="text-sm truncate">{project.name}</span>
              </div>
            ))}
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground p-2">No projects</p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <User className="h-3 w-3 mr-1" />
            Assignee
            {filters.assigneeIds.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {filters.assigneeIds.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => toggleArrayFilter("assigneeIds", user.id)}
              >
                <Checkbox
                  checked={filters.assigneeIds.includes(user.id)}
                  className="pointer-events-none"
                />
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  {user.name?.charAt(0) ?? "?"}
                </div>
                <span className="text-sm truncate">{user.name ?? "Unknown"}</span>
              </div>
            ))}
            {users.length === 0 && (
              <p className="text-sm text-muted-foreground p-2">No users</p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Tag className="h-3 w-3 mr-1" />
            Label
            {filters.labelIds.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {filters.labelIds.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => toggleArrayFilter("labelIds", label.id)}
              >
                <Checkbox
                  checked={filters.labelIds.includes(label.id)}
                  className="pointer-events-none"
                />
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="text-sm truncate">{label.name}</span>
              </div>
            ))}
            {labels.length === 0 && (
              <p className="text-sm text-muted-foreground p-2">No labels</p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Calendar className="h-3 w-3 mr-1" />
            Due Date
            {filters.dueDateFilter !== "all" && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                1
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2" align="start">
          <div className="space-y-1">
            {[
              { value: "all", label: "All" },
              { value: "overdue", label: "Overdue" },
              { value: "next7d", label: "Next 7 days" },
              { value: "none", label: "No due date" },
            ].map((option) => (
              <div
                key={option.value}
                className={cn(
                  "px-2 py-1.5 rounded text-sm cursor-pointer",
                  filters.dueDateFilter === option.value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
                onClick={() =>
                  updateFilter(
                    "dueDateFilter",
                    option.value as KanbanFilters["dueDateFilter"]
                  )
                }
              >
                {option.label}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {(activeFilterCount > 0 || filters.search) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          className="text-muted-foreground"
        >
          <X className="h-3 w-3 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

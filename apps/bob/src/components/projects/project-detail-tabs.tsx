"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@gmacko/core/ui/badge";

import { StageBadge } from "~/components/workflow/stage-badge";
import type { StageDetectionInput } from "~/lib/workflow/stage";

import {
  KIND_COLOR,
  PRIORITY_COLOR,
  STATUS_COLOR,
  formatLabel,
} from "~/lib/design/colors";

import { WorkItemBoard } from "~/components/work-items/work-item-board";
import type { WorkItemBoardItem } from "~/components/work-items/work-item-board";
import { RequirementsChecklist } from "~/components/work-items/requirements-checklist";
import { AutomationSettings } from "~/components/projects/automation-settings";
import { RepositoryPanel } from "~/components/dashboard";
import {
  buildProjectConfigurationManagementGroups,
  type ProjectConfigurationManagementGroup,
  type ProjectConfigurationSection,
  type ProjectConfigurationSectionStatus,
} from "~/components/projects/project-status-model";
import {
  getProjectWorkItemHref,
  type ProjectDetailTabKey,
} from "./project-detail-tabs-model";

export interface ProjectWorkItem {
  id: string;
  identifier: string;
  title: string;
  status: string;
  kind: string;
  priority: string;
  updatedAt: string | null;
}

interface ProjectDetailTabsProps {
  items: ProjectWorkItem[];
  /** The top-level epic work item ID for the requirements tab, if any */
  epicWorkItemId?: string;
  epicWorkItemKind?: string;
  /** Project ID for the settings tab */
  projectId: string;
  /** Current automation settings from the project */
  automationSettings?: {
    autoDispatch?: boolean;
    autoBranch?: boolean;
    autoFeaturePR?: boolean;
    ciTrigger?: boolean;
    reactFrontend?: boolean;
  };
  /** Project default agent (null = inherit workspace default). */
  defaultAgentType?: string | null;
  configurationSections?: ProjectConfigurationSection[];
  initialTab?: ProjectDetailTabKey;
  workspaceId?: string | null;
}

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  canceled: 5,
};

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  no_priority: 4,
  none: 5,
};

function sortForList(items: ProjectWorkItem[]): ProjectWorkItem[] {
  return [...items].sort((a, b) => {
    const statusA = STATUS_ORDER[a.status] ?? 99;
    const statusB = STATUS_ORDER[b.status] ?? 99;
    if (statusA !== statusB) return statusA - statusB;

    const prioA = PRIORITY_ORDER[a.priority] ?? 99;
    const prioB = PRIORITY_ORDER[b.priority] ?? 99;
    return prioA - prioB;
  });
}

export function ProjectDetailTabs({
  items,
  epicWorkItemId,
  epicWorkItemKind,
  projectId,
  automationSettings,
  defaultAgentType,
  configurationSections = [],
  initialTab = "board",
  workspaceId,
}: ProjectDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<ProjectDetailTabKey>(initialTab);

  const tabs: { key: ProjectDetailTabKey; label: string }[] = [
    { key: "board", label: "Board" },
    { key: "list", label: "List" },
    { key: "requirements", label: "Requirements" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">
          {items.length} items
        </span>
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === "board" && <BoardTab items={items} workspaceId={workspaceId} />}
        {activeTab === "list" && <ListTab items={items} workspaceId={workspaceId} />}
        {activeTab === "requirements" && (
          <RequirementsTab
            epicWorkItemId={epicWorkItemId}
            epicWorkItemKind={epicWorkItemKind}
          />
        )}
        {activeTab === "settings" && (
          <div id="project-settings" className="space-y-8 scroll-mt-24">
            <ProjectConfigurationManagement sections={configurationSections} />
            <AutomationSettings
              initialDefaultAgentType={defaultAgentType}
              projectId={projectId}
              initialSettings={automationSettings}
            />
            <RepositoryPanel projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
}

const CONFIG_SECTION_STATUS_CLASS: Record<ProjectConfigurationSectionStatus, string> = {
  ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-500",
  missing: "border-rose-500/25 bg-rose-500/10 text-rose-500",
};

function ProjectConfigurationManagement({
  sections,
}: {
  sections: ProjectConfigurationSection[];
}) {
  const groups = buildProjectConfigurationManagementGroups(sections);

  if (sections.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Project configuration status is not available yet.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div>
        <h3 className="font-display text-lg font-bold text-foreground">
          Bob Configuration
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage identity, repository mapping, integrations, planning defaults, execution settings, secrets, and validation state.
        </p>
      </div>

      <div className="mt-5 space-y-5">
        {groups.map((group) => (
          <ProjectConfigurationGroup key={group.key} group={group} />
        ))}
      </div>
    </section>
  );
}

function ProjectConfigurationGroup({
  group,
}: {
  group: ProjectConfigurationManagementGroup;
}) {
  if (group.sections.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {group.title}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {group.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {group.actions.map((action) => (
            <a
              key={action.key}
              href={`#${action.targetId}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              {action.label}
            </a>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {group.sections.map((section) => (
          <div
            key={section.key}
            id={section.key === "validation" ? "project-validation" : undefined}
            className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h5 className="truncate text-sm font-semibold text-foreground">
                {section.title}
              </h5>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${CONFIG_SECTION_STATUS_CLASS[section.status]}`}
              >
                {section.status}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {section.items.map((item) => (
                <div key={`${section.key}-${item.label}`} className="min-w-0">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {item.label}
                  </div>
                  <div
                    className="mt-0.5 truncate text-xs font-medium text-foreground"
                    title={item.value}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardTab({
  items,
  workspaceId,
}: {
  items: ProjectWorkItem[];
  workspaceId?: string | null;
}) {
  const boardItems: WorkItemBoardItem[] = items.map((item) => ({
    id: item.id,
    identifier: item.identifier,
    title: item.title,
    status: item.status,
    kind: item.kind,
    priority: item.priority,
    href: getProjectWorkItemHref(item, workspaceId),
  }));

  return <WorkItemBoard items={boardItems} />;
}

function ListTab({
  items,
  workspaceId,
}: {
  items: ProjectWorkItem[];
  workspaceId?: string | null;
}) {
  const sorted = sortForList(items);

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No work items yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Identifier</th>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Priority</th>
            <th className="px-4 py-3">Kind</th>
            <th className="px-4 py-3">Stage</th>
            <th className="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <tr
              key={item.id}
              className="border-b border-border transition last:border-b-0 hover:bg-accent/50"
            >
              <td className="px-4 py-3">
                <Link
                  href={getProjectWorkItemHref(item, workspaceId)}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {item.identifier}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={getProjectWorkItemHref(item, workspaceId)}
                  className="font-medium text-primary hover:underline"
                >
                  {item.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={STATUS_COLOR[item.status] ?? "default"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {formatLabel(item.status)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={PRIORITY_COLOR[item.priority] ?? "default"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {formatLabel(item.priority)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={KIND_COLOR[item.kind] ?? "default"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {item.kind}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <StageBadge
                  stageInput={{
                    workItem: { kind: item.kind, status: item.status },
                    requirementCount: 0,
                    childTaskCount: 0,
                    dispatchedTaskCount: 0,
                    completedTaskCount: 0,
                    openPRCount: 0,
                    mergedFeaturePR: false,
                    healthyDeployment: false,
                  } satisfies StageDetectionInput}
                />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {item.updatedAt
                  ? new Date(item.updatedAt).toLocaleDateString()
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequirementsTab({
  epicWorkItemId,
  epicWorkItemKind,
}: {
  epicWorkItemId?: string;
  epicWorkItemKind?: string;
}) {
  if (!epicWorkItemId || !epicWorkItemKind) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No top-level epic found for this project. Requirements are tracked on
        epic or issue work items.
      </div>
    );
  }

  return (
    <RequirementsChecklist
      workItemId={epicWorkItemId}
      workItemKind={epicWorkItemKind}
    />
  );
}

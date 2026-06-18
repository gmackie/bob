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

type TabKey = "board" | "list" | "requirements" | "settings";

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
}: ProjectDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("board");

  const tabs: { key: TabKey; label: string }[] = [
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
        {activeTab === "board" && <BoardTab items={items} />}
        {activeTab === "list" && <ListTab items={items} />}
        {activeTab === "requirements" && (
          <RequirementsTab
            epicWorkItemId={epicWorkItemId}
            epicWorkItemKind={epicWorkItemKind}
          />
        )}
        {activeTab === "settings" && (
          <div className="space-y-8">
            <AutomationSettings
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

function BoardTab({ items }: { items: ProjectWorkItem[] }) {
  const boardItems: WorkItemBoardItem[] = items.map((item) => ({
    id: item.id,
    identifier: item.identifier,
    title: item.title,
    status: item.status,
    kind: item.kind,
    priority: item.priority,
  }));

  return <WorkItemBoard items={boardItems} />;
}

function ListTab({ items }: { items: ProjectWorkItem[] }) {
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
                  href={`/work-items/${item.id}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {item.identifier}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/work-items/${item.id}`}
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

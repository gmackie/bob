"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@bob/ui/badge";

import type {
  ProjectWorkItem,
  RequirementTarget,
} from "./project-detail-utils";
import type { WorkItemBoardItem } from "~/components/work-items/work-item-board";
import type { StageDetectionInput } from "~/lib/workflow/stage";
import { RepositoryPanel } from "~/components/dashboard";
import { AutomationSettings } from "~/components/projects/automation-settings";
import { FilterableBoard } from "~/components/work-items/board-filter-bar";
import { RequirementsChecklist } from "~/components/work-items/requirements-checklist";
import { StageBadge } from "~/components/workflow/stage-badge";
import {
  formatLabel,
  KIND_COLOR,
  PRIORITY_COLOR,
  STATUS_COLOR,
} from "~/lib/design/colors";
import { getRequirementTargets } from "./project-detail-utils";

export type { ProjectWorkItem } from "./project-detail-utils";

type TabKey = "board" | "list" | "requirements" | "settings";

interface ProjectDetailTabsProps {
  items: ProjectWorkItem[];
  /** Preferred requirements owner, usually the first top-level epic. */
  defaultRequirementsWorkItemId?: string;
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
  defaultRequirementsWorkItemId,
  projectId,
  automationSettings,
}: ProjectDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("board");
  const requirementTargets = getRequirementTargets(items);

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
        <span className="text-muted-foreground ml-auto text-sm">
          {items.length} items
        </span>
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === "board" && <BoardTab items={items} />}
        {activeTab === "list" && <ListTab items={items} />}
        {activeTab === "requirements" && (
          <RequirementsTab
            targets={requirementTargets}
            defaultWorkItemId={defaultRequirementsWorkItemId}
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
    parentId: item.parentId,
  }));

  return <FilterableBoard items={boardItems} />;
}

function ListTab({ items }: { items: ProjectWorkItem[] }) {
  const sorted = sortForList(items);

  if (sorted.length === 0) {
    return (
      <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
        No work items yet.
      </div>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-secondary text-muted-foreground border-b text-left text-xs font-semibold tracking-wide uppercase">
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
              className="border-border hover:bg-accent/50 border-b transition last:border-b-0"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/work-items/${item.id}`}
                  className="text-primary font-mono text-xs hover:underline"
                >
                  {item.identifier}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/work-items/${item.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {item.title}
                </Link>
                {item.description ? (
                  <div className="text-muted-foreground mt-1 max-w-xl truncate text-xs">
                    {item.description}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={STATUS_COLOR[item.status] ?? "default"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {formatLabel(item.status)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={PRIORITY_COLOR[item.priority] ?? "default"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {formatLabel(item.priority)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={KIND_COLOR[item.kind] ?? "default"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {item.kind}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <StageBadge
                  stageInput={
                    {
                      workItem: { kind: item.kind, status: item.status },
                      requirementCount: 0,
                      childTaskCount: 0,
                      dispatchedTaskCount: 0,
                      completedTaskCount: 0,
                      openPRCount: 0,
                      mergedFeaturePR: false,
                      healthyDeployment: false,
                    } satisfies StageDetectionInput
                  }
                />
              </td>
              <td className="text-muted-foreground px-4 py-3 text-xs">
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
  targets,
  defaultWorkItemId,
}: {
  targets: RequirementTarget[];
  defaultWorkItemId?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    defaultWorkItemId ?? targets[0]?.id ?? null,
  );

  const selected =
    targets.find((target) => target.id === selectedId) ?? targets[0];

  if (!selected) {
    return (
      <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
        Create an epic or issue to start tracking project requirements.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            onClick={() => setSelectedId(target.id)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              selected.id === target.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="block font-mono text-[11px] tracking-[0.18em] uppercase">
              {target.identifier}
            </span>
            <span className="mt-1 block max-w-64 truncate font-medium">
              {target.title}
            </span>
          </button>
        ))}
      </div>

      <RequirementsChecklist
        workItemId={selected.id}
        workItemKind={selected.kind}
      />
    </div>
  );
}

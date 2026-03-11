"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

import type { SessionStatus } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";
import { getAvailableAgentTypes } from "~/utils/platform";

type InteractionMode = "web" | "headless";

function normalizeSessionStatus(status: string): SessionStatus {
  return [
    "provisioning",
    "starting",
    "running",
    "idle",
    "stopping",
    "stopped",
    "error",
  ].includes(status)
    ? (status as SessionStatus)
    : "stopped";
}

const statusFilters: { value: SessionStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "idle", label: "Idle" },
  { value: "stopped", label: "Stopped" },
  { value: "error", label: "Error" },
];

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "now";
}

function StatusIndicator({ status }: { status: SessionStatus }) {
  const className = `chat-sessionStatusDot chat-sessionStatusDot--${
    status === "starting" || status === "provisioning"
      ? status
      : status === "running"
        ? "running"
        : status === "idle"
          ? "idle"
          : status === "stopping"
            ? "stopping"
            : status === "error"
              ? "error"
              : "stopped"
  }`;

  return <span className={cn(className)} title={status} />;
}

function focusFilterButton(
  buttons: Array<HTMLButtonElement | null>,
  targetIndex: number,
) {
  const button = buttons[targetIndex];
  if (button) {
    button.focus();
  }
}

export function SessionList({
  selectedId,
  selectedMode = "web",
  onSelect,
}: {
  selectedId?: string;
  selectedMode?: InteractionMode;
  onSelect: (id: string, mode?: InteractionMode) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SessionStatus | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [selectedAgentType, setSelectedAgentType] =
    useState<string>("opencode");
  const filterButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { data, isLoading, error } = useQuery(
    trpc.session.list.queryOptions({
      status: filter === "all" ? undefined : filter,
      limit: 50,
    }),
  );

  const createMutation = useMutation(
    trpc.session.bootstrapForChat.mutationOptions({
      onSuccess: (bootstrapResult) => {
        const newSessionId = bootstrapResult.id;

        void queryClient.invalidateQueries({
          queryKey: trpc.session.list.queryKey(),
        });
        if (!newSessionId) return;
        setShowNewSessionModal(false);
        onSelect(newSessionId, selectedMode);
      },
    }),
  );

  const sessions = useMemo(() => data?.items ?? [], [data?.items]);
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredSessions = useMemo(() => {
    if (!normalizedSearch) return sessions;

    return sessions.filter((session) => {
      const title = (
        session.title ?? `Session ${session.id.slice(0, 8)}`
      ).toLowerCase();
      const dir = (session.workingDirectory ?? "").toLowerCase();

      return (
        title.includes(normalizedSearch) ||
        dir.includes(normalizedSearch) ||
        session.id.toLowerCase().includes(normalizedSearch) ||
        session.agentType.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [sessions, normalizedSearch]);

  const handleNewSession = () => {
    setShowNewSessionModal(true);
  };

  const handleCreateSession = () => {
    void createMutation.mutate({
      workingDirectory: process.cwd(),
      agentType: selectedAgentType,
    });
  };

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebarHeader">
        <div className="chat-sidebarHeaderText">
          <h2 className="chat-sidebarTitle">Sessions</h2>
          <div className="chat-sidebarSubtext">
            {filteredSessions.length} of {sessions.length}
          </div>
        </div>
        <Button
          className="chat-sidebarButton chat-sidebarButtonPrimary"
          size="sm"
          onClick={handleNewSession}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "..." : "+ New"}
        </Button>
      </div>

      {showNewSessionModal && (
        <div className="chat-modalBackdrop">
          <div className="chat-modal">
            <h3 className="chat-modalTitle">Create New Session</h3>
            <div className="chat-modalRow">
              <label className="chat-modalLabel">Agent Type</label>
              <select
                value={selectedAgentType}
                onChange={(e) => setSelectedAgentType(e.target.value)}
                className="chat-modalSelect"
              >
                {getAvailableAgentTypes().map((agent) => (
                  <option key={agent.value} value={agent.value}>
                    {agent.icon} {agent.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="chat-modalActions">
              <Button
                className="chat-actionButton"
                size="sm"
                onClick={() => setShowNewSessionModal(false)}
              >
                Cancel
              </Button>
              <Button
                className="chat-actionButton chat-sidebarButtonPrimary"
                size="sm"
                onClick={handleCreateSession}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="chat-sidebarBody">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="chat-sidebarSearch"
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
        <div
          className="chat-filterRow"
          role="tablist"
          aria-label="Session filters"
        >
          {statusFilters.map((option, index) => {
            const isActive = filter === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-pressed={isActive}
                ref={(el) => {
                  filterButtonRefs.current[index] = el;
                }}
                onClick={() => setFilter(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    const nextIndex = (index + 1) % statusFilters.length;
                    const nextFilter = statusFilters[nextIndex];
                    focusFilterButton(filterButtonRefs.current, nextIndex);
                    if (nextFilter) setFilter(nextFilter.value);
                  }

                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    const prevIndex =
                      (index - 1 + statusFilters.length) % statusFilters.length;
                    const prevFilter = statusFilters[prevIndex];
                    focusFilterButton(filterButtonRefs.current, prevIndex);
                    if (prevFilter) setFilter(prevFilter.value);
                  }

                  if (event.key === "Home") {
                    event.preventDefault();
                    const firstFilter = statusFilters[0];
                    if (firstFilter) {
                      focusFilterButton(filterButtonRefs.current, 0);
                      setFilter(firstFilter.value);
                    }
                  }

                  if (event.key === "End") {
                    event.preventDefault();
                    const lastIndex = statusFilters.length - 1;
                    const lastFilter = statusFilters[lastIndex];
                    if (lastFilter) {
                      focusFilterButton(filterButtonRefs.current, lastIndex);
                      setFilter(lastFilter.value);
                    }
                  }

                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setFilter(option.value);
                  }
                }}
                className={cn("chat-filterChip", isActive && "is-active")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="chat-sidebarMeta">
          {filter !== "all" ? `${filter} sessions` : "All sessions"} ·{" "}
          {searchTerm.trim()
            ? `filtered by "${searchTerm.trim()}"`
            : "No filter"}
        </div>
      </div>

      <div className="chat-sessionList" aria-live="polite">
        {isLoading && <div className="chat-emptyText">Loading...</div>}

        {error && (
          <div className="chat-emptyText is-error">Failed to load sessions</div>
        )}

        {!isLoading && !error && filteredSessions.length === 0 && (
          <div className="chat-emptyText">
            {searchTerm.trim() || filter !== "all"
              ? "No sessions match these filters"
              : "No sessions found"}
          </div>
        )}

        {filteredSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session.id, selectedMode)}
            className={cn(
              "chat-sessionItem",
              selectedId === session.id && "is-active",
            )}
          >
            <div className="chat-sessionItemHead">
              <StatusIndicator
                status={normalizeSessionStatus(session.status)}
              />
              <span className="chat-sessionItemTitle">
                {session.title ?? `Session ${session.id.slice(0, 8)}`}
              </span>
            </div>
            <div className="chat-sessionItemMeta">
              <span className="chat-sessionItemMetaValue">
                {session.agentType}
              </span>
              {session.issueManaged && (
                <>
                  <span>·</span>
                  <span className="chat-sessionItemMetaValue">Issue-managed</span>
                </>
              )}
              {session.linkedTask && (
                <>
                  <span>·</span>
                  <span className="chat-sessionItemMetaValue">
                    {session.linkedTask.identifier}
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                {formatRelativeTime(
                  session.lastActivityAt ?? session.createdAt,
                )}
              </span>
            </div>
            {session.workingDirectory && (
              <span
                className="chat-sessionItemDir"
                title={session.workingDirectory}
              >
                {session.workingDirectory}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

type CespSeverity = "info" | "warning" | "error";
type CespCategory =
  | "session.start"
  | "session.end"
  | "task.acknowledge"
  | "task.complete"
  | "task.error"
  | "input.required"
  | "resource.limit"
  | "task.progress"
  | "user.spam";

type CespSource = "task-run" | "agent-instance" | "event-log";

interface CespAlert {
  id: string;
  category: CespCategory;
  title: string;
  message: string;
  severity: CespSeverity;
  occurredAt: string;
  source: CespSource;
  sourceId: string;
  projectId?: string | null;
  repository?: {
    id: string;
    name: string;
    path: string;
    kanbangerProjectId: string | null;
  } | null;
  metadata: Record<string, unknown>;
}

interface CespAlertsResponse {
  alerts: CespAlert[];
  generatedAt: string;
}

const CESP_POLL_INTERVAL_MS = 20_000;
const CESP_POLL_LIMIT = 80;
const CESP_SEEN_LIMIT = 300;
const CESP_INAPP_ALERT_MAX = 2;
const CESP_INAPP_ALERT_TTL_MS = 12_000;
const MAX_TIME_TOLERANCE_MS = 1500;
const CESP_DEBUG =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_CESP_DEBUG === "1";

function logCespDebug(message: string, payload?: Record<string, unknown>) {
  if (!CESP_DEBUG) return;
  if (payload) {
    console.info(`[CESP][web] ${message}`, payload);
    return;
  }
  console.info(`[CESP][web] ${message}`);
}

function canUseNotificationsApi(): boolean {
  return typeof window !== "undefined" && typeof window.Notification !== "undefined";
}

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

function toNotificationBody(alert: CespAlert): string {
  const base = alert.message.trim();
  if (base.length === 0) return `${alert.title}`;
  return base;
}

function getProjectLabel(alert: CespAlert): string | null {
  if (alert.repository?.name) return alert.repository.name;
  if (alert.projectId) return alert.projectId;
  return null;
}

function getAlertDestination(alert: CespAlert): string {
  const projectId =
    alert.projectId ?? alert.repository?.kanbangerProjectId ?? null;
  const taskId =
    typeof alert.metadata?.issueId === "string"
      ? alert.metadata.issueId.trim()
      : "";
  const search = new URLSearchParams();
  if (projectId) {
    search.set("project", projectId);
  }
  if (taskId) {
    search.set("task", taskId);
  }
  if (search.size === 0) {
    return "/dashboard";
  }
  return `/dashboard?${search.toString()}`;
}

function getNotificationTitle(alert: CespAlert): string {
  const project = getProjectLabel(alert);
  if (!project) {
    return alert.title;
  }
  return `[${project}] ${alert.title}`;
}

function getNotificationBody(alert: CespAlert): string {
  const body = toNotificationBody(alert);
  const repoPath = alert.repository?.path?.trim();
  if (!repoPath) return body;
  return `${body}\n${repoPath}`;
}

function buildSeenTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Date.now();
  }

  return parsed;
}

function pruneSeenIds(seenIds: Map<string, number>) {
  if (seenIds.size <= CESP_SEEN_LIMIT) return;

  const ordered = [...seenIds.entries()].sort((a, b) => a[1] - b[1]);
  const overflow = ordered.length - CESP_SEEN_LIMIT;
  for (let i = 0; i < overflow; i++) {
    const [id] = ordered[i] ?? [];
    if (id) seenIds.delete(id);
  }
}

function getInitialSince(): string {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

function getNextSince(value: string | undefined): string {
  if (!value) return new Date(Date.now() - 60 * 1000).toISOString();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return new Date(Date.now() - 60 * 1000).toISOString();

  return new Date(Math.max(parsed - MAX_TIME_TOLERANCE_MS, 0)).toISOString();
}

function getInAppAlertRoot(): HTMLElement | null {
  if (typeof window === "undefined") return null;

  let root = document.getElementById("cesp-inapp-alert-root");
  if (root) return root;

  root = document.createElement("div");
  root.id = "cesp-inapp-alert-root";
  root.style.position = "fixed";
  root.style.top = "16px";
  root.style.left = "16px";
  root.style.right = "16px";
  root.style.maxWidth = "420px";
  root.style.marginLeft = "auto";
  root.style.zIndex = "1000";
  root.style.display = "grid";
  root.style.gap = "8px";
  root.style.pointerEvents = "none";
  root.style.fontFamily =
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  document.body.appendChild(root);

  return root;
}

function enforceInAppAlertLimit(root: HTMLElement) {
  const alerts = Array.from(
    root.querySelectorAll<HTMLElement>("[data-cesp-inapp-alert]"),
  );
  const toRemove = Math.max(0, alerts.length - CESP_INAPP_ALERT_MAX);
  for (let i = 0; i < toRemove; i++) {
    alerts[i]?.remove();
  }
}

function showInAppNotification(alert: CespAlert) {
  if (document.visibilityState === "hidden") {
    return;
  }

  const root = getInAppAlertRoot();
  if (!root) return;

  const isUrgent =
    alert.severity === "error" || alert.severity === "warning";

  const toast = document.createElement("div");
  toast.dataset.cespInappAlert = "1";
  toast.style.position = "relative";
  toast.style.pointerEvents = "auto";
  toast.style.border = "1px solid rgba(255, 255, 255, 0.2)";
  toast.style.borderLeftWidth = "4px";
  toast.style.borderLeftColor = isUrgent ? "#ff5a6a" : "#64a0ff";
  toast.style.background = "rgba(9, 12, 18, 0.95)";
  toast.style.color = "#e8eef8";
  toast.style.borderRadius = "10px";
  toast.style.padding = "10px 12px";
  toast.style.boxShadow = "0 18px 50px rgba(0, 0, 0, 0.55)";
  toast.style.backdropFilter = "blur(4px)";
  toast.style.overflowWrap = "anywhere";
  toast.style.fontSize = "12px";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "12px";
  title.style.marginBottom = "4px";
  title.style.display = "flex";
  title.style.alignItems = "center";
  title.style.gap = "8px";

  const marker = document.createElement("span");
  marker.style.display = "inline-block";
  marker.style.width = "7px";
  marker.style.height = "7px";
  marker.style.borderRadius = "999px";
  marker.style.background =
    alert.severity === "error"
      ? "#ff5a6a"
      : alert.severity === "warning"
        ? "#ffb020"
        : "#64a0ff";
  title.appendChild(marker);

  const titleText = document.createElement("span");
  titleText.textContent = getNotificationTitle(alert);
  title.appendChild(titleText);
  toast.appendChild(title);

  const body = document.createElement("div");
  body.style.color = "rgba(232, 238, 248, 0.88)";
  body.style.lineHeight = "1.35";
  body.textContent = getNotificationBody(alert);
  toast.appendChild(body);

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Dismiss alert");
  close.style.position = "absolute";
  close.style.top = "6px";
  close.style.right = "8px";
  close.style.border = "1px solid rgba(255, 255, 255, 0.2)";
  close.style.background = "rgba(255, 255, 255, 0.08)";
  close.style.color = "#e8eef8";
  close.style.borderRadius = "999px";
  close.style.width = "18px";
  close.style.height = "18px";
  close.style.fontSize = "10px";
  close.style.lineHeight = "16px";
  close.style.padding = "0";
  close.style.cursor = "pointer";
  close.style.opacity = "0.85";
  close.onclick = (event) => {
    event.stopPropagation();
    toast.remove();
  };
  toast.appendChild(close);

  const actionUrl = getAlertDestination(alert);
  const canNavigate = Boolean(actionUrl);
  if (canNavigate) {
    const actionText = document.createElement("span");
    actionText.style.marginTop = "6px";
    actionText.style.display = "inline-flex";
    actionText.style.alignItems = "center";
    actionText.style.justifyContent = "center";
    actionText.style.padding = "3px 8px";
    actionText.style.borderRadius = "999px";
    actionText.style.fontSize = "10px";
    actionText.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    actionText.style.background = "rgba(255, 255, 255, 0.08)";
    actionText.style.color = "rgba(232, 238, 248, 0.95)";
    actionText.textContent = "Open in dashboard";
    toast.appendChild(actionText);
  }

  if (canVibrate() && (isUrgent || alert.category === "task.complete")) {
    if (alert.severity === "error") {
      navigator.vibrate([120, 80, 120]);
    } else if (alert.severity === "warning") {
      navigator.vibrate([100]);
    } else {
      navigator.vibrate([40]);
    }
  }

  root.appendChild(toast);
  enforceInAppAlertLimit(root);

  const timeout = window.setTimeout(() => {
    toast.remove();
  }, CESP_INAPP_ALERT_TTL_MS);

  toast.addEventListener("mouseenter", () => {
    window.clearTimeout(timeout);
  });
  toast.addEventListener("click", () => {
    const destination = getAlertDestination(alert);
    logCespDebug("in-app alert clicked", {
      alertId: alert.id,
      destination: destination ?? null,
    });
    if (destination) {
      window.focus();
      window.location.assign(destination);
    }
    toast.remove();
  });
}

export function CESPNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const trpc = useTRPC();
  const { data: preferences } = useQuery(
    trpc.settings.getPreferences.queryOptions(undefined),
  );

  const enabled = preferences?.pushNotifications ?? false;
  const seenIdsRef = useRef(new Map<string, number>());
  const sinceRef = useRef(getInitialSince());
  const timerRef = useRef<number | null>(null);

  const notify = useCallback((alert: CespAlert) => {
    if (!canUseNotificationsApi()) return;
    if (Notification.permission !== "granted") return;

    const title = getNotificationTitle(alert);
    const destination = getAlertDestination(alert);
    logCespDebug("creating browser notification", {
      alertId: alert.id,
      category: alert.category,
      destination,
    });
    const notification = new Notification(title, {
      body: getNotificationBody(alert),
      tag: alert.id,
      data: {
        category: alert.category,
        source: alert.source,
        sourceId: alert.sourceId,
        destination,
      },
    });

    notification.onclick = (event) => {
      event.preventDefault();
      notification.close();
      logCespDebug("browser notification clicked", {
        alertId: alert.id,
        destination: destination ?? null,
      });
      if (destination) {
        window.focus();
        window.location.assign(destination);
      }
    };
  }, []);

  const dispatchAlert = useCallback(
    (alert: CespAlert) => {
      if (canUseNotificationsApi() && Notification.permission === "granted") {
        notify(alert);
        return;
      }

      showInAppNotification(alert);
    },
    [notify],
  );

  const poll = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const since = sinceRef.current;
    const until = new Date().toISOString();

    try {
      const response = await fetch(
        `/api/cesp/v1/alerts?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=${CESP_POLL_LIMIT}`,
      );

      if (!response.ok) {
        return;
      }

      const body = (await response.json()) as CespAlertsResponse;
      const rawAlerts = Array.isArray(body.alerts) ? body.alerts : [];
      const alerts = rawAlerts
        .filter((alert) => !seenIdsRef.current.has(alert.id))
        .sort(
          (a, b) =>
            new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
        );
      logCespDebug("polled alerts", {
        since,
        until,
        rawCount: rawAlerts.length,
        newCount: alerts.length,
      });

      for (const alert of alerts) {
        if (seenIdsRef.current.has(alert.id)) {
          continue;
        }

        seenIdsRef.current.set(alert.id, buildSeenTimestamp(alert.occurredAt));
        pruneSeenIds(seenIdsRef.current);
        dispatchAlert(alert);
      }

      sinceRef.current = getNextSince(body.generatedAt);
    } catch (error) {
      console.error("Failed to fetch CESP alerts", error);
    }
  }, [dispatchAlert, enabled]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const startPolling = async () => {
      if (canUseNotificationsApi() && Notification.permission === "default") {
        await Notification.requestPermission();
      }

      sinceRef.current = getNextSince(undefined);
      await poll();

      timerRef.current = window.setInterval(() => {
        void poll();
      }, CESP_POLL_INTERVAL_MS);
    };

    void startPolling();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, poll]);

  return <>{children}</>;
}

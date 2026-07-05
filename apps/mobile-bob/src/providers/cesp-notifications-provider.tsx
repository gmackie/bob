import {  useCallback, useEffect, useRef } from "react";
import type {ReactNode} from "react";
import { Linking, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { scheduleLocalNotification, Notifications } from "@bob/notifications";

import { getBaseUrl } from "~/utils/base-url";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

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
    planningProjectId: string | null;
  } | null;
  metadata: Record<string, unknown>;
}

interface CespAlertsResponse {
  alerts: CespAlert[];
  generatedAt: string;
}

interface ProvidersProps {
  children: ReactNode;
}

const CESP_POLL_INTERVAL_MS = 20_000;
const CESP_POLL_LIMIT = 80;
const CESP_SEEN_LIMIT = 300;
const MAX_TIME_TOLERANCE_MS = 1500;
const PLANNING_PATH_PREFIX = "/planning";
const CESP_DEBUG =
  __DEV__ ||
  process.env.EXPO_PUBLIC_CESP_DEBUG === "1" ||
  process.env.EXPO_PUBLIC_DEEP_LINK_DEBUG === "1";

function logCespDebug(message: string, payload?: Record<string, unknown>) {
  if (!CESP_DEBUG) return;
  if (payload) {
    console.info(`[CESP][mobile] ${message}`, payload);
    return;
  }
  console.info(`[CESP][mobile] ${message}`);
}

interface CESPDestPayload {
  destination?: string;
  destinationPath?: string;
  destinationTask?: string | null;
  destinationProject?: string | null;
}

function getProjectFromAlert(alert: CespAlert): string | null {
  if (alert.repository?.planningProjectId) {
    return alert.repository.planningProjectId;
  }
  if (alert.projectId) {
    return alert.projectId;
  }
  return null;
}

function getTaskFromAlert(alert: CespAlert): string | null {
  if (typeof alert.metadata.issueId === "string") {
    const candidate = alert.metadata.issueId.trim();
    if (candidate.length > 0) return candidate;
  }
  return null;
}

function buildPlanningDestination(alert: CespAlert): string {
  const projectId = getProjectFromAlert(alert);
  const taskId = getTaskFromAlert(alert);
  const search = new URLSearchParams();

  if (projectId) {
    search.set("project", projectId);
  }
  if (taskId) {
    search.set("task", taskId);
  }

  return search.size === 0
    ? PLANNING_PATH_PREFIX
    : `${PLANNING_PATH_PREFIX}?${search.toString()}`;
}

function toAbsolutePlanningUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const base = getBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function parsePlanningPathFromDestination(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(PLANNING_PATH_PREFIX)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname !== PLANNING_PATH_PREFIX) return null;
    return `${PLANNING_PATH_PREFIX}${parsed.search}`;
  } catch {
    return null;
  }
}

function buildDestinationFromPayload(
  data: CESPDestPayload | undefined,
): string | null {
  if (!data) return null;

  if (typeof data.destinationPath === "string") {
    const fromPath = parsePlanningPathFromDestination(data.destinationPath);
    if (fromPath) return fromPath;
  }

  if (typeof data.destination === "string") {
    const fromDestination = parsePlanningPathFromDestination(data.destination);
    if (fromDestination) return fromDestination;
  }

  const search = new URLSearchParams();
  const project = data.destinationProject?.trim();
  const task = data.destinationTask?.trim();
  if (project) search.set("project", project);
  if (task) search.set("task", task);
  if (search.size > 0) {
    return `${PLANNING_PATH_PREFIX}?${search.toString()}`;
  }

  return null;
}

function getProjectLabel(alert: CespAlert): string | null {
  if (alert.repository?.name) return alert.repository.name;
  if (alert.projectId) return alert.projectId;
  return null;
}

function getNotificationTitle(alert: CespAlert): string {
  const project = getProjectLabel(alert);
  if (!project) return alert.title;
  return `[${project}] ${alert.title}`;
}

function getNotificationBody(alert: CespAlert): string {
  const body = alert.message.trim();
  const label = body.length > 0 ? body : alert.title;
  const repoPath = alert.repository?.path.trim();
  if (!repoPath) return label;
  return `${label}\n${repoPath}`;
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

function canUseNotificationsApi(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

async function hasNotificationPermission(): Promise<boolean> {
  if (!canUseNotificationsApi()) return false;

  const status = await Notifications.getPermissionsAsync();
  if (status.status === Notifications.PermissionStatus.GRANTED) {
    return true;
  }

  const next = await Notifications.requestPermissionsAsync();
  return next.status === Notifications.PermissionStatus.GRANTED;
}

export function CESPNotificationsProvider({ children }: ProvidersProps) {
  const { data: session } = authClient.useSession();
  const { data: preferences } = useQuery({
    ...trpc.settings.getPreferences.queryOptions(undefined),
    enabled: !!session,
  });

  const enabled = preferences?.pushNotifications ?? false;
  const seenIdsRef = useRef(new Map<string, number>());
  const sinceRef = useRef(getInitialSince());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHandledResponseIdRef = useRef<string | null>(null);

  const notify = useCallback((alert: CespAlert) => {
    const destinationPath = buildPlanningDestination(alert);
    logCespDebug("scheduling local notification", {
      alertId: alert.id,
      category: alert.category,
      destinationPath,
    });
    void scheduleLocalNotification(
      getNotificationTitle(alert),
      getNotificationBody(alert),
      {
        data: {
          destinationPath,
          destination: toAbsolutePlanningUrl(destinationPath),
          destinationProject: getProjectFromAlert(alert),
          destinationTask: getTaskFromAlert(alert),
        } satisfies CESPDestPayload,
      },
    );
  }, []);

  const handleNotificationResponse = useCallback((response: Notifications.NotificationResponse) => {
    const responseId = response.notification.request.identifier;
    logCespDebug("notification response received", { responseId });
    if (lastHandledResponseIdRef.current === responseId) {
      logCespDebug("skipping duplicate notification response", { responseId });
      return;
    }
    lastHandledResponseIdRef.current = responseId;

    const data = response.notification.request.content.data as
      | CESPDestPayload
      | undefined;
    logCespDebug("notification response payload", {
      responseId,
      hasData: Boolean(data),
    });
    const destinationPath = buildDestinationFromPayload(data);
    if (!destinationPath) {
      logCespDebug("notification response missing destination", { responseId });
      return;
    }

    const absoluteDestination = toAbsolutePlanningUrl(destinationPath);
    logCespDebug("opening destination from notification response", {
      responseId,
      destinationPath,
      absoluteDestination,
    });
    void Linking.openURL(absoluteDestination);
  }, []);

  useEffect(() => {
    if (!enabled || !canUseNotificationsApi()) return;

    let active = true;
    void Notifications.getLastNotificationResponseAsync().then(
      (response: Notifications.NotificationResponse | null) => {
        if (!active || !response) return;
        handleNotificationResponse(response);
      },
    );

    const subscription =
      Notifications.addNotificationResponseReceivedListener(
        (response: Notifications.NotificationResponse) => {
        handleNotificationResponse(response);
      },
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, [enabled, handleNotificationResponse]);

  const poll = useCallback(async () => {
    if (!enabled || !canUseNotificationsApi()) return;

    const since = sinceRef.current;
    const until = new Date().toISOString();

    const sessionCookie = authClient.getCookie();
    const headers: Record<string, string> = {};
    if (sessionCookie) {
      headers.Cookie = sessionCookie;
    }

    try {
      const response = await fetch(
        `${getBaseUrl()}/api/cesp/v1/alerts?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=${CESP_POLL_LIMIT}`,
        {
          headers,
          credentials: "include",
        },
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
        if (seenIdsRef.current.has(alert.id)) continue;

        seenIdsRef.current.set(alert.id, buildSeenTimestamp(alert.occurredAt));
        pruneSeenIds(seenIdsRef.current);
        notify(alert);
      }

      sinceRef.current = getNextSince(body.generatedAt);
    } catch (error) {
      console.error("Failed to fetch CESP alerts", error);
    }
  }, [enabled, notify]);

  useEffect(() => {
    if (!enabled || !canUseNotificationsApi()) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const startPolling = async () => {
      const permissionGranted = await hasNotificationPermission();
      if (!permissionGranted) {
        logCespDebug("notification permission not granted");
        return;
      }

      sinceRef.current = getNextSince(undefined);
      await poll();
      timerRef.current = setInterval(() => {
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

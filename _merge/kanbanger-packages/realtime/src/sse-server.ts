import Redis from "ioredis";

export interface SSEEvent {
  type: string;
  data: unknown;
  workspaceId?: string;
  projectId?: string;
  issueId?: string;
}

export interface RepoWorktreeFilesystemInfo {
  totalFiles: number;
  totalDirectories: number;
  totalSizeBytes?: number;
  newestModifiedAt?: string;
  oldestModifiedAt?: string;
  largestFileBytes?: number;
}

export interface RepoWorktreeMetadata {
  filesystem?: RepoWorktreeFilesystemInfo;
  changedPaths?: string[];
  changedFileCount?: number;
  featureSignals?: string[];
  workspacePath?: string;
  [key: string]: unknown;
}

export interface RepoWorktreeStatus {
  workspaceId: string;
  deviceId: string;
  vcs: "git" | "jj" | "other";
  repositoryIdentifier: string;
  projectId?: string;
  branch?: string;
  revision?: string;
  status?: "clean" | "dirty" | "conflict" | "diverged" | "paused" | "unknown";
  changedFiles?: number;
  ahead?: number;
  behind?: number;
  message?: string;
  metadata?: RepoWorktreeMetadata | Record<string, unknown>;
  reportedAt: string;
}

export interface RepoWorktreeDevicePresence extends RepoWorktreeStatus {
  copyId: string;
  lastSeenAt: string;
}

export const REPO_STATUS_DEVICE_STATE_TTL_SECONDS = 180;
export const REPO_STATUS_DEVICE_INDEX_TTL_SECONDS = 240;
export const REPO_STATUS_DEVICE_PREFIX = "repo-status-device";

export function encodeRepositoryIdentifier(repositoryIdentifier: string): string {
  return Buffer.from(repositoryIdentifier).toString("base64url");
}

export function getRepoStatusDeviceStateKey(
  workspaceId: string,
  deviceId: string,
  repositoryIdentifier: string
): string {
  const hashedRepository = encodeRepositoryIdentifier(repositoryIdentifier);
  return `${REPO_STATUS_DEVICE_PREFIX}:workspace:${workspaceId}:state:${deviceId}:${hashedRepository}`;
}

export function getRepoStatusDeviceIndexKey(workspaceId: string): string {
  return `${REPO_STATUS_DEVICE_PREFIX}:workspace:${workspaceId}:index`;
}

export const SSE_EVENTS = {
  ISSUE_CREATED: "issue:created",
  ISSUE_UPDATED: "issue:updated",
  ISSUE_DELETED: "issue:deleted",
  ISSUE_REORDERED: "issue:reordered",
  COMMENT_CREATED: "comment:created",
  LABEL_CREATED: "label:created",
  LABEL_UPDATED: "label:updated",
  FORGE_REVISION_INDEXED: "forge:revision_indexed",
  FORGE_RUN_OVERLAY_UPDATED: "forge:run_overlay_updated",
  REPO_WORKTREE_STATUS_UPDATED: "repo-worktree:status_updated",
} as const;

export type SSEEventType = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];

let publisher: Redis | null = null;

function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(getRedisUrl());
    publisher.on("error", () => {});
  }
  return publisher;
}

export function createSubscriber(): Redis {
  const redis = new Redis(getRedisUrl());
  redis.on("error", () => {});
  return redis;
}

export async function publishEvent(
  channel: string,
  event: SSEEvent
): Promise<void> {
  const pub = getPublisher();
  await pub.publish(channel, JSON.stringify(event));
}

export async function publishIssueEvent(
  eventType: SSEEventType,
  workspaceId: string,
  data: unknown,
  projectId?: string,
  issueId?: string
): Promise<void> {
  const event: SSEEvent = {
    type: eventType,
    data,
    workspaceId,
    projectId,
    issueId,
  };

  await publishEvent(`workspace:${workspaceId}`, event);
}

export async function publishRepoWorktreeStatusEvent(
  status: RepoWorktreeStatus
): Promise<void> {
  const safeStatus = {
    ...status,
    reportedAt: status.reportedAt || new Date().toISOString(),
  };

  await publishEvent(`workspace:${safeStatus.workspaceId}`, {
    type: SSE_EVENTS.REPO_WORKTREE_STATUS_UPDATED,
    data: safeStatus,
  });
}

export function createSSEStream(
  workspaceId: string,
  onClose?: () => void
): {
  readable: ReadableStream<Uint8Array>;
  cleanup: () => void;
} {
  const subscriber = createSubscriber();
  const encoder = new TextEncoder();
  let isActive = true;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      subscriber.subscribe(`workspace:${workspaceId}`);

      subscriber.on("message", (_channel: string, message: string) => {
        if (!isActive) return;

        try {
          const event = JSON.parse(message) as SSEEvent;
          const sseMessage = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(sseMessage));
        } catch {
          void 0;
        }
      });

      const keepAlive = setInterval(() => {
        if (isActive) {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }
      }, 30000);

      subscriber.on("close", () => {
        clearInterval(keepAlive);
        isActive = false;
        onClose?.();
      });
    },

    cancel() {
      isActive = false;
      try {
        subscriber.unsubscribe().catch(() => {});
        subscriber.quit().catch(() => {});
      } catch {
        void 0;
      }
      onClose?.();
    },
  });

  const cleanup = () => {
    isActive = false;
    try {
      subscriber.unsubscribe().catch(() => {});
      subscriber.quit().catch(() => {});
    } catch {
      void 0;
    }
  };

  return { readable, cleanup };
}

export function createSSEResponse(
  workspaceId: string,
  request: Request
): Response {
  const { readable, cleanup } = createSSEStream(workspaceId, () => {});

  if (request.signal) {
    request.signal.addEventListener("abort", cleanup);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Response(readable as any, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

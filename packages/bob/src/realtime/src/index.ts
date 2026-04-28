import Pusher from "pusher";
import PusherClient from "pusher-js";

import { integrations } from "@bob/config";

export const WORK_ITEM_EVENTS = {
  UPDATED: "work-item:updated",
  COMMENT_CREATED: "work-item:comment_created",
  ARTIFACT_UPDATED: "work-item:artifact_updated",
  NOTIFICATION_CREATED: "notification:created",
} as const;

export function getWorkspaceRealtimeChannel(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function getWorkItemRealtimeChannel(
  workspaceId: string,
  workItemId: string,
): string {
  return `${getWorkspaceRealtimeChannel(workspaceId)}:work-item:${workItemId}`;
}

let pusherServer: Pusher | null = null;
let pusherClient: PusherClient | null = null;

export interface PusherServerConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

export interface PusherClientConfig {
  key: string;
  cluster: string;
}

/**
 * Initialize Pusher server (for triggering events)
 * Only initializes if realtime integration is enabled
 */
export function initPusherServer(config: PusherServerConfig): Pusher | null {
  if (!integrations.realtime.enabled) {
    console.log("[Realtime disabled] Pusher server initialization skipped");
    return null;
  }

  if (!pusherServer) {
    pusherServer = new Pusher({
      appId: config.appId,
      key: config.key,
      secret: config.secret,
      cluster: config.cluster,
      useTLS: true,
    });
  }

  return pusherServer;
}

/**
 * Initialize Pusher client (for subscribing to events)
 * Only initializes if realtime integration is enabled
 */
export function initPusherClient(
  config: PusherClientConfig,
): PusherClient | null {
  if (!integrations.realtime.enabled) {
    console.log("[Realtime disabled] Pusher client initialization skipped");
    return null;
  }

  if (!pusherClient) {
    pusherClient = new PusherClient(config.key, {
      cluster: config.cluster,
    });
  }

  return pusherClient;
}

/**
 * Get the Pusher server instance
 */
export function getPusherServer(): Pusher | null {
  if (!integrations.realtime.enabled) {
    return null;
  }
  return pusherServer;
}

/**
 * Get the Pusher client instance
 */
export function getPusherClient(): PusherClient | null {
  if (!integrations.realtime.enabled) {
    return null;
  }
  return pusherClient;
}

/**
 * Trigger an event on a channel
 */
export async function triggerEvent(
  channel: string,
  event: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const server = getPusherServer();
  if (!server) {
    console.log("[Realtime disabled] Cannot trigger event:", event);
    return false;
  }

  await server.trigger(channel, event, data);
  return true;
}

export async function triggerWorkItemEvent(input: {
  workspaceId: string;
  workItemId: string;
  event: (typeof WORK_ITEM_EVENTS)[keyof typeof WORK_ITEM_EVENTS];
  data: Record<string, unknown>;
}): Promise<boolean> {
  return triggerEvent(
    getWorkItemRealtimeChannel(input.workspaceId, input.workItemId),
    input.event,
    input.data,
  );
}

export { Pusher, PusherClient };

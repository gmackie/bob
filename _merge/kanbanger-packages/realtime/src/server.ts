import Pusher from "pusher";

export interface RealtimeConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

export interface PusherEvent {
  channel: string;
  event: string;
  data: unknown;
}

export const CHANNELS = {
  DASHBOARD: "dashboard",
  USER: (userId: string) => `private-user-${userId}`,
  NOTIFICATIONS: (userId: string) => `private-notifications-${userId}`,
} as const;

export const EVENTS = {
  STATS_UPDATE: "stats-update",
  NEW_NOTIFICATION: "new-notification",
  USER_ACTIVITY: "user-activity",
} as const;

let pusherInstance: Pusher | null = null;

export function getPusherServer(config?: RealtimeConfig): Pusher {
  if (pusherInstance) return pusherInstance;

  const finalConfig = config ?? {
    appId: process.env.PUSHER_APP_ID ?? "",
    key: process.env.NEXT_PUBLIC_PUSHER_KEY ?? "",
    secret: process.env.PUSHER_SECRET ?? "",
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "us2",
  };

  pusherInstance = new Pusher({
    appId: finalConfig.appId,
    key: finalConfig.key,
    secret: finalConfig.secret,
    cluster: finalConfig.cluster,
    useTLS: true,
  });

  return pusherInstance;
}

export async function triggerEvent(
  channel: string,
  event: string,
  data: unknown
): Promise<void> {
  const pusher = getPusherServer();
  await pusher.trigger(channel, event, data);
}

export async function triggerBatch(events: PusherEvent[]): Promise<void> {
  const pusher = getPusherServer();
  await pusher.triggerBatch(
    events.map((e) => ({
      channel: e.channel,
      name: e.event,
      data: e.data,
    }))
  );
}

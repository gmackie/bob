import type { Notification, NotificationType } from "./index";

interface ExpoPushMessage {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface SendPushResult {
  success: boolean;
  ticketId?: string;
  error?: string;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function sendPushNotification(
  token: string,
  notification: { title: string; body: string; data?: Record<string, unknown> }
): Promise<SendPushResult> {
  return sendPushNotifications([token], notification).then((results) => results[0]!);
}

export async function sendPushNotifications(
  tokens: string[],
  notification: { title: string; body: string; data?: Record<string, unknown> }
): Promise<SendPushResult[]> {
  if (tokens.length === 0) {
    return [];
  }

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    sound: "default",
    priority: "high",
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const error = await response.text();
      return tokens.map(() => ({ success: false, error }));
    }

    const result = (await response.json()) as { data: ExpoPushTicket[] };
    
    return result.data.map((ticket) => {
      if (ticket.status === "ok") {
        return { success: true, ticketId: ticket.id };
      }
      return { success: false, error: ticket.message ?? "Unknown error" };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return tokens.map(() => ({ success: false, error: message }));
  }
}

export function createNotification(params: {
  userId: string;
  title: string;
  body: string;
  type?: NotificationType;
  data?: Record<string, unknown>;
}): Omit<Notification, "id"> {
  return {
    userId: params.userId,
    title: params.title,
    body: params.body,
    type: params.type ?? "info",
    read: false,
    data: params.data,
    createdAt: new Date(),
  };
}

export function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") && token.endsWith("]");
}

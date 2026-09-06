import {
  getNotificationsHref,
  getNotificationTargetHref,
  getWorkItemHref,
} from "./navigation";

interface NotificationDestinationInput {
  url: string | null;
  workItemId: string | null;
}

interface NotificationPreviewSubtitleInput {
  body: string | null;
  type: string;
}

function normalizeInAppPath(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function getNotificationDestination(
  input: NotificationDestinationInput,
) {
  const fromUrl = input.url ? normalizeInAppPath(input.url) : null;
  if (fromUrl) {
    const target = getNotificationTargetHref({ url: fromUrl });
    if (target) return target;
  }

  if (input.workItemId) {
    return getWorkItemHref(input.workItemId);
  }

  return getNotificationsHref();
}

export function getNotificationPreviewSubtitle(
  input: NotificationPreviewSubtitleInput,
): string {
  const body = input.body?.trim();
  if (body) {
    return body;
  }

  return input.type.replace(/_/g, " ");
}

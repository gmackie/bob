import { getNotificationsHref, getWorkItemHref } from "./navigation";

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
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function getNotificationDestination(
  input: NotificationDestinationInput,
): string {
  const fromUrl = input.url ? normalizeInAppPath(input.url) : null;
  if (fromUrl) {
    return fromUrl;
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

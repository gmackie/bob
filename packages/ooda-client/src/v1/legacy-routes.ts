export function conversationUrlForLegacyThread(threadId: string): string {
  return `/conversations?conversation=${encodeURIComponent(threadId)}`;
}

export function conversationsUrlForLegacyList(search: string): string {
  return new URLSearchParams(search).get("new") === "1"
    ? "/conversations?new=1"
    : "/conversations";
}

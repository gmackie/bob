import type { ForkConversationInputV1 } from "@gmacko/ooda-client/v1";

import type { OodaTimelineItem } from "./ooda-timeline";

export function findLatestForkPoint(
  timeline: readonly OodaTimelineItem[],
): { eventId: string; branchId: string } | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index]?.event;
    if (event) return { eventId: event.id, branchId: event.branchId };
  }
  return undefined;
}

export function buildForkConversationInput(
  input: ForkConversationInputV1,
): ForkConversationInputV1 {
  const reason = input.reason?.trim();
  return {
    conversationId: input.conversationId,
    parentBranchId: input.parentBranchId,
    forkEventId: input.forkEventId,
    name: input.name.trim(),
    ...(reason ? { reason } : {}),
    idempotencyKey: input.idempotencyKey,
  };
}

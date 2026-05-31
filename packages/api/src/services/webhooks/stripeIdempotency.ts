import { db } from "@bob/db/client";
import { processedEvents } from "@bob/db/schema";

export type StripeEventProcessingResult = "processed" | "duplicate";

/**
 * Claims a Stripe event for processing.
 *
 * Returns false when the event ID already exists, which lets webhook handlers
 * acknowledge Stripe retries/replays without running side effects twice.
 */
export async function claimStripeEvent(eventId: string): Promise<boolean> {
  const [processedEvent] = await db
    .insert(processedEvents)
    .values({ provider: "stripe", eventId })
    .onConflictDoNothing({
      target: [processedEvents.provider, processedEvents.eventId],
    })
    .returning({ id: processedEvents.id });

  return Boolean(processedEvent);
}

export async function processStripeEventOnce<TEvent extends { id: string }>(
  event: TEvent,
  handler: (event: TEvent) => Promise<void>,
): Promise<StripeEventProcessingResult> {
  const shouldProcess = await claimStripeEvent(event.id);
  if (!shouldProcess) {
    return "duplicate";
  }

  await handler(event);
  return "processed";
}

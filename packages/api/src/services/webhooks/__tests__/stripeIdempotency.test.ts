import { beforeEach, describe, expect, it, vi } from "vitest";

import { processStripeEventOnce } from "../stripeIdempotency";

const { returningMock, processedEventsTable } = vi.hoisted(() => ({
  returningMock: vi.fn(),
  processedEventsTable: {
    id: { name: "id" },
    provider: { name: "provider" },
    eventId: { name: "event_id" },
  },
}));

vi.mock("@bob/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: returningMock,
        })),
      })),
    })),
  },
}));

vi.mock("@bob/db/schema", () => ({
  processedEvents: processedEventsTable,
}));

describe("Stripe webhook idempotency", () => {
  beforeEach(() => {
    returningMock.mockReset();
  });

  it("processes a newly claimed Stripe event", async () => {
    returningMock.mockResolvedValueOnce([{ id: "processed-event-1" }]);
    const handler = vi.fn(async () => {});
    const event = { id: "evt_123", type: "checkout.session.completed" };

    const result = await processStripeEventOnce(event, handler);

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("skips duplicate Stripe events", async () => {
    returningMock.mockResolvedValueOnce([]);
    const handler = vi.fn(async () => {});

    const result = await processStripeEventOnce({ id: "evt_123" }, handler);

    expect(result).toBe("duplicate");
    expect(handler).not.toHaveBeenCalled();
  });
});

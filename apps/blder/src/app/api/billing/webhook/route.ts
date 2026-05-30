import { NextResponse } from "next/server";

import {
  constructStripeWebhookEvent,
  getStripeClient,
  syncStripeSubscription,
} from "@bob/api/services/billing/stripeBilling";
import { db } from "@bob/db/client";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const event = constructStripeWebhookEvent({
      body,
      signature: request.headers.get("stripe-signature"),
    });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (typeof session.subscription === "string") {
        const subscription = await getStripeClient().subscriptions.retrieve(
          session.subscription,
        );
        await syncStripeSubscription({ db, subscription });
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncStripeSubscription({
        db,
        subscription: event.data.object,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

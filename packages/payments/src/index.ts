import Stripe from "stripe";

import { integrations } from "@bob/config";

let stripeClient: Stripe | null = null;

export interface StripeConfig {
  secretKey: string;
  apiVersion?: Stripe.LatestApiVersion;
}

export type StripeCredentialStatus =
  | "disabled"
  | "missing_secret_key"
  | "invalid_secret_key"
  | "ready";

export interface StripeIntegrationStatus {
  enabled: boolean;
  status: StripeCredentialStatus;
  reason: string | null;
}

type EnabledStripeCredentialStatus = Exclude<
  StripeCredentialStatus,
  "disabled"
>;

export interface StripeSecretKeyStatus {
  status: EnabledStripeCredentialStatus;
  reason: string | null;
}

const STRIPE_SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;

function normalizeSecretKey(secretKey: string | null | undefined): string {
  return secretKey?.trim() ?? "";
}

export function getStripeSecretKeyStatus(
  secretKey: string | null | undefined,
): StripeSecretKeyStatus {
  const normalized = normalizeSecretKey(secretKey);

  if (!normalized) {
    return {
      status: "missing_secret_key",
      reason: "Stripe secret key is not configured.",
    };
  }

  if (!STRIPE_SECRET_KEY_PATTERN.test(normalized)) {
    return {
      status: "invalid_secret_key",
      reason:
        "Stripe secret key must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
    };
  }

  return {
    status: "ready",
    reason: null,
  };
}

export function getStripeIntegrationStatus(
  config?: Partial<StripeConfig> | null,
): StripeIntegrationStatus {
  if (!integrations.stripe) {
    return {
      enabled: false,
      status: "disabled",
      reason: "Stripe integration is disabled.",
    };
  }

  const secretStatus = getStripeSecretKeyStatus(config?.secretKey);

  return {
    enabled: true,
    ...secretStatus,
  };
}

/**
 * Initialize Stripe client
 * Only initializes if stripe integration is enabled
 */
export function initStripe(config: StripeConfig): Stripe | null {
  const status = getStripeIntegrationStatus(config);

  if (status.status === "disabled") {
    console.log("[Stripe disabled] Stripe initialization skipped");
    return null;
  }

  if (status.status !== "ready") {
    console.warn(`[Stripe ${status.status}] ${status.reason}`);
    return null;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(normalizeSecretKey(config.secretKey), {
      apiVersion: config.apiVersion,
    });
  }

  return stripeClient;
}

/**
 * Get the Stripe client instance
 */
export function getStripe(): Stripe | null {
  if (!integrations.stripe) {
    return null;
  }
  return stripeClient;
}

/**
 * Create a checkout session
 */
export async function createCheckoutSession(
  params: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session | null> {
  const stripe = getStripe();
  if (!stripe) {
    console.log("[Stripe disabled] Cannot create checkout session");
    return null;
  }
  return stripe.checkout.sessions.create(params);
}

/**
 * Create a billing portal session
 */
export async function createBillingPortalSession(
  params: Stripe.BillingPortal.SessionCreateParams,
): Promise<Stripe.BillingPortal.Session | null> {
  const stripe = getStripe();
  if (!stripe) {
    console.log("[Stripe disabled] Cannot create billing portal session");
    return null;
  }
  return stripe.billingPortal.sessions.create(params);
}

export { Stripe };

/**
 * Minimal, dependency-free Stripe client.
 *
 * We deliberately avoid pulling in the `stripe` SDK: the surface we need
 * (create a Checkout Session, verify a webhook signature, read subscription
 * fields off an event) is small and stable, and staying on `fetch` +
 * `node:crypto` keeps the package installable in the coexistence sandbox.
 *
 * Signature verification implements Stripe's documented scheme:
 *   signed_payload = `${timestamp}.${rawBody}`
 *   expected       = HMAC-SHA256(webhookSecret, signed_payload)  (hex)
 * compared in constant time against every `v1` in the `Stripe-Signature` header.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com";
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export function getStripeSecretKey(): string | undefined {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key == null || key === "" ? undefined : key;
}

export function getStripeWebhookSecret(): string | undefined {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  return secret == null || secret === "" ? undefined : secret;
}

/** Parse a `Stripe-Signature` header into its timestamp and v1 signatures. */
export function parseStripeSignatureHeader(header: string): {
  timestamp: number | null;
  signatures: string[];
} {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (!key || value === undefined) continue;
    if (key.trim() === "t") {
      const parsed = Number.parseInt(value.trim(), 10);
      timestamp = Number.isNaN(parsed) ? null : parsed;
    } else if (key.trim() === "v1") {
      signatures.push(value.trim());
    }
  }
  return { timestamp, signatures };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify a Stripe webhook signature. Returns true only when a `v1` signature
 * matches and the timestamp is within `toleranceSeconds` of `nowSeconds`
 * (replay protection). `nowSeconds` is injectable for deterministic tests.
 */
export function verifyStripeSignature(opts: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const { rawBody, signatureHeader, secret } = opts;
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  if (timestamp === null || signatures.length === 0) return false;

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return signatures.some((sig) => safeEqualHex(sig, expected));
}

// --- Event shapes (only the fields we consume) ---

export interface StripeSubscriptionObject {
  readonly id: string;
  readonly customer: string;
  readonly status: string;
  readonly cancel_at_period_end?: boolean;
  readonly current_period_end?: number;
  readonly items?: {
    readonly data?: readonly {
      readonly price?: { readonly id?: string };
    }[];
  };
  readonly metadata?: Record<string, string>;
}

export interface StripeEvent {
  readonly id: string;
  readonly type: string;
  readonly data: { readonly object: Record<string, unknown> };
}

export function parseStripeEvent(rawBody: string): StripeEvent {
  const parsed = JSON.parse(rawBody) as Partial<StripeEvent> | null;
  if (!parsed || typeof parsed.type !== "string" || !parsed.data?.object) {
    throw new Error("Malformed Stripe event payload");
  }
  return parsed as StripeEvent;
}

// --- Checkout ---

/** Encode a nested params object into Stripe's bracketed form encoding. */
function toFormBody(
  params: Record<string, string | number | undefined>,
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.append(key, String(value));
  }
  return usp.toString();
}

export interface CheckoutSessionParams {
  readonly priceId: string;
  readonly tenantId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Reuse an existing Stripe customer when the tenant already has one. */
  readonly customerId?: string;
  readonly customerEmail?: string;
}

export interface CheckoutSession {
  readonly id: string;
  readonly url: string;
}

/**
 * Create a Stripe Checkout Session for a subscription. Throws when
 * `STRIPE_SECRET_KEY` is unset or the API returns an error.
 */
export async function createCheckoutSession(
  params: CheckoutSessionParams,
): Promise<CheckoutSession> {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  const body = toFormBody({
    mode: "subscription",
    "line_items[0][price]": params.priceId,
    "line_items[0][quantity]": 1,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.tenantId,
    // Stamp the tenant on the subscription so webhooks can resolve it even if
    // the customer record is shared or the client_reference_id is dropped.
    "subscription_data[metadata][tenantId]": params.tenantId,
    customer: params.customerId,
    customer_email: params.customerId ? undefined : params.customerEmail,
  });

  const res = await fetch(`${STRIPE_API_BASE}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Stripe checkout session failed (${res.status}): ${detail}`,
    );
  }

  const json = (await res.json()) as { id?: string; url?: string };
  if (!json.id || !json.url) {
    throw new Error("Stripe checkout session response missing id/url");
  }
  return { id: json.id, url: json.url };
}

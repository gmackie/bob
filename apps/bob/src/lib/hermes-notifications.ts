import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const CODE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;

const code = z.string().regex(CODE);
const recordSchema = z
  .object({
    kind: code,
    id: z.string().regex(RECORD_ID),
    href: z.string().url(),
  })
  .strict()
  .superRefine((record, context) => {
    const url = new URL(record.href);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.hash ||
      [...url.searchParams].length !== 2 ||
      url.searchParams.get("recordKind") !== record.kind ||
      url.searchParams.get("recordId") !== record.id ||
      [...url.searchParams.keys()].some(
        (key) => key !== "recordKind" && key !== "recordId",
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "record href must be a matching HTTPS control-plane link",
      });
    }
  });

export const skillfleetNotificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    notificationId: z.string().min(1).max(256).regex(RECORD_ID),
    deliveryClass: z.enum(["immediate", "digest"]),
    scheduledFor: z.iso.datetime({ offset: true }),
    event: code,
    severity: z.enum(["urgent", "action"]),
    owner: code,
    consequence: code,
    nextStep: code,
    record: recordSchema,
    counts: z
      .object({ urgent: z.number().int().nonnegative(), action: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict();

export type SkillfleetNotification = z.infer<typeof skillfleetNotificationSchema>;
export type DeliveryClaim = "new" | "retry" | "processed" | "pending" | "conflict";

export interface DeliveryLedger {
  claim(idempotencyKey: string, payload: SkillfleetNotification): Promise<DeliveryClaim>;
  markProcessed(idempotencyKey: string): Promise<void>;
  markFailed(idempotencyKey: string, message: string): Promise<void>;
}

export interface DeliveryRepository {
  insert(idempotencyKey: string, payload: SkillfleetNotification): Promise<boolean>;
  find(idempotencyKey: string): Promise<
    | {
        payload: unknown;
        status: string;
        receivedAt: string;
      }
    | undefined
  >;
  reclaim(idempotencyKey: string, staleBefore: string): Promise<boolean>;
  markProcessed(idempotencyKey: string): Promise<void>;
  markFailed(idempotencyKey: string, message: string): Promise<void>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createDeliveryLedger(
  repository: DeliveryRepository,
  now: () => Date = () => new Date(),
): DeliveryLedger {
  return {
    async claim(idempotencyKey, payload) {
      if (await repository.insert(idempotencyKey, payload)) return "new";
      const existing = await repository.find(idempotencyKey);
      if (!existing) return "pending";
      if (canonicalJson(existing.payload) !== canonicalJson(payload)) return "conflict";
      if (existing.status === "processed") return "processed";

      const staleBefore = new Date(now().getTime() - MAX_CLOCK_SKEW_SECONDS * 1000);
      const isStale = new Date(existing.receivedAt).getTime() < staleBefore.getTime();
      if (existing.status !== "failed" && !isStale) return "pending";
      return (await repository.reclaim(idempotencyKey, staleBefore.toISOString()))
        ? "retry"
        : "pending";
    },
    markProcessed: (idempotencyKey) => repository.markProcessed(idempotencyKey),
    markFailed: (idempotencyKey, message) => repository.markFailed(idempotencyKey, message),
  };
}

interface HandlerDependencies {
  ingressSecret: string;
  hermesOrigin: string;
  hermesOriginToken: string;
  ledger: DeliveryLedger;
  fetch?: typeof fetch;
  now?: () => Date;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function verifySignature(
  body: string,
  headers: Headers,
  secret: string,
  now: Date,
): boolean {
  const timestamp = headers.get("x-skillfleet-timestamp");
  const supplied = headers.get("x-skillfleet-signature");
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !supplied?.startsWith("sha256=")) {
    return false;
  }
  const timestampSeconds = Number(timestamp);
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest();
  const signatureHex = supplied.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(signatureHex)) return false;
  const actual = Buffer.from(signatureHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyOriginAuthorization(
  authorization: string | null,
  secret: string,
): boolean {
  if (!authorization?.startsWith("Bearer ") || !secret) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function isAllowedHermesServiceRequest(method: string | null, uri: string | null): boolean {
  if (!method || !uri) return false;
  const url = new URL(uri, "https://hermes.invalid");
  if (url.origin !== "https://hermes.invalid") return false;
  if (method === "GET" && url.pathname === "/hermes/" && !url.search) return true;
  if (
    method === "GET" &&
    url.pathname === "/hermes/api/cron/delivery-targets" &&
    !url.search
  ) return true;
  if (
    (method === "GET" || method === "POST") &&
    url.pathname === "/hermes/api/cron/jobs" &&
    url.searchParams.size === 1 &&
    url.searchParams.get("profile") === "default"
  ) return true;
  return false;
}

function hermesHeaders(originToken: string, sessionToken?: string): HeadersInit {
  return {
    authorization: `Bearer ${originToken}`,
    ...(sessionToken ? { "x-hermes-session-token": sessionToken } : {}),
  };
}

function extractSessionToken(html: string): string | null {
  return html.match(/__HERMES_SESSION_TOKEN__\s*=\s*(["'])([^"']+)\1/)?.[2] ?? null;
}

function scheduledTime(notification: SkillfleetNotification, now: Date): string {
  const requested = new Date(notification.scheduledFor).getTime();
  const earliest = now.getTime() + 60_000;
  return new Date(Math.max(requested, earliest)).toISOString();
}

function promptFor(notification: SkillfleetNotification): string {
  return [
    "Write a concise fleet notification using only the facts in the JSON below.",
    "Do not use tools, add facts, expose hidden context, or change counts.",
    "Include the source link and a clear next action.",
    JSON.stringify(notification),
  ].join("\n");
}

async function checked(response: Response, label: string): Promise<Response> {
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response;
}

async function scheduleWithHermes(
  notification: SkillfleetNotification,
  dependencies: HandlerDependencies,
  now: Date,
): Promise<{ id: string; deduplicated: boolean }> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const originUrl = new URL(dependencies.hermesOrigin);
  if (
    originUrl.protocol !== "https:" ||
    originUrl.username ||
    originUrl.password ||
    originUrl.pathname !== "/" ||
    originUrl.search ||
    originUrl.hash
  ) throw new Error("Hermes origin is invalid");
  const origin = originUrl.origin;
  const bootstrap = await checked(
    await fetchImpl(`${origin}/hermes/`, {
      headers: hermesHeaders(dependencies.hermesOriginToken),
    }),
    "Hermes bootstrap",
  );
  const sessionToken = extractSessionToken(await bootstrap.text());
  if (!sessionToken) throw new Error("Hermes session token is unavailable");
  const headers = hermesHeaders(dependencies.hermesOriginToken, sessionToken);

  const targetsResponse = await checked(
    await fetchImpl(`${origin}/hermes/api/cron/delivery-targets`, { headers }),
    "Hermes delivery targets",
  );
  const targets = (await targetsResponse.json()) as {
    targets?: Array<{ id?: string; home_target_set?: boolean }>;
  };
  const telegram = targets.targets?.find((target) => target.id === "telegram");
  if (!telegram?.home_target_set) {
    throw new Error("Hermes Telegram delivery target is unavailable");
  }

  const name = `skillfleet:${notification.notificationId}`;
  const jobsResponse = await checked(
    await fetchImpl(`${origin}/hermes/api/cron/jobs?profile=default`, { headers }),
    "Hermes job list",
  );
  const jobs = (await jobsResponse.json()) as Array<{ id?: string; name?: string }>;
  const existing = jobs.find((job) => job.name === name);
  if (existing?.id) return { id: existing.id, deduplicated: true };

  const createResponse = await checked(
    await fetchImpl(`${origin}/hermes/api/cron/jobs?profile=default`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        prompt: promptFor(notification),
        schedule: scheduledTime(notification, now),
        deliver: "telegram",
      }),
    }),
    "Hermes job create",
  );
  const created = (await createResponse.json()) as { id?: string };
  if (!created.id) throw new Error("Hermes job response omitted its id");
  return { id: created.id, deduplicated: false };
}

export async function handleSkillfleetNotification(
  request: Request,
  dependencies: HandlerDependencies,
): Promise<Response> {
  const now = dependencies.now?.() ?? new Date();
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers, dependencies.ingressSecret, now)) {
    return json({ error: "unauthorized" }, 401);
  }

  let notification: SkillfleetNotification;
  try {
    notification = skillfleetNotificationSchema.parse(JSON.parse(rawBody));
  } catch {
    return json({ error: "invalid_notification" }, 400);
  }

  const claim = await dependencies.ledger.claim(
    notification.notificationId,
    notification,
  );
  if (claim === "processed") return json({ ok: true, deduplicated: true }, 200);
  if (claim === "pending") return json({ ok: true, pending: true }, 202);
  if (claim === "conflict") return json({ error: "idempotency_conflict" }, 409);

  try {
    const result = await scheduleWithHermes(notification, dependencies, now);
    await dependencies.ledger.markProcessed(notification.notificationId);
    return json(
      {
        ok: true,
        ...(result.deduplicated ? { deduplicated: true } : {}),
        jobId: result.id,
      },
      result.deduplicated ? 200 : 201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hermes delivery failed";
    await dependencies.ledger.markFailed(notification.notificationId, message.slice(0, 500));
    return json(
      { error: message === "Hermes Telegram delivery target is unavailable" ? "telegram_unavailable" : "hermes_unavailable" },
      message === "Hermes Telegram delivery target is unavailable" ? 503 : 502,
    );
  }
}

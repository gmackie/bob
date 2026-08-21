import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createDeliveryLedger,
  handleSkillfleetNotification,
  type DeliveryRepository,
  type DeliveryLedger,
  type SkillfleetNotification,
  isAllowedHermesServiceRequest,
  verifyOriginAuthorization,
} from "./hermes-notifications";

const NOW = new Date("2026-08-21T16:00:00.000Z");
const SECRET = "skillfleet-ingress-secret";
const ORIGIN_TOKEN = "bob-to-hermes-origin-secret";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    notificationId: "urgent:skill-install-failed:machine-1",
    deliveryClass: "immediate",
    scheduledFor: NOW.toISOString(),
    event: "skill-install-failed",
    severity: "urgent",
    owner: "fleet-operator",
    consequence: "machine-missing-required-skill",
    nextStep: "review-install-record",
    record: {
      kind: "deployment-record",
      id: "deploy:machine-1:42",
      href: "https://skills.example.com/?recordKind=deployment-record&recordId=deploy%3Amachine-1%3A42",
    },
    ...overrides,
  };
}

function signedRequest(bodyValue = envelope(), timestamp = NOW) {
  const body = JSON.stringify(bodyValue);
  const seconds = Math.floor(timestamp.getTime() / 1000).toString();
  const signature = createHmac("sha256", SECRET)
    .update(`${seconds}.${body}`)
    .digest("hex");
  return new Request("https://bob.example.com/api/v1/hermes/notifications", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-skillfleet-timestamp": seconds,
      "x-skillfleet-signature": `sha256=${signature}`,
    },
    body,
  });
}

function ledger(claim: DeliveryLedger["claim"] = vi.fn().mockResolvedValue("new")) {
  return {
    claim,
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  } satisfies DeliveryLedger;
}

function hermesFetch(options: { existing?: boolean; targets?: unknown } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    expect(request.headers.get("authorization")).toBe(`Bearer ${ORIGIN_TOKEN}`);

    if (url.pathname === "/hermes/") {
      return new Response('<script>window.__HERMES_SESSION_TOKEN__="rotating-token"</script>');
    }
    expect(request.headers.get("x-hermes-session-token")).toBe("rotating-token");
    if (url.pathname.endsWith("/delivery-targets")) {
      return Response.json(
        options.targets ?? {
          targets: [{ id: "telegram", home_target_set: true }],
        },
      );
    }
    if (request.method === "GET") {
      return Response.json(
        options.existing
          ? [{ name: "skillfleet:urgent:skill-install-failed:machine-1", id: "job-1" }]
          : [],
      );
    }
    return Response.json({ id: "job-created" });
  });
}

function run(request: Request, overrides: Record<string, unknown> = {}) {
  return handleSkillfleetNotification(request, {
    now: () => NOW,
    ingressSecret: SECRET,
    hermesOrigin: "https://claude.example.com",
    hermesOriginToken: ORIGIN_TOKEN,
    ledger: ledger(),
    fetch: hermesFetch(),
    ...overrides,
  });
}

describe("Skillfleet Hermes notification ingress", () => {
  it("accepts Skillfleet's cross-repository HMAC test vector", async () => {
    const body = '{"schemaVersion":1,"notificationId":"urgent:2026-08-20:subscription:codex-main:subscription-exhausted","deliveryClass":"immediate","scheduledFor":"2026-08-20T14:00:00.000Z","event":"subscription-exhausted","severity":"urgent","owner":"administration","consequence":"provider-capacity-unavailable","nextStep":"reconcile-subscription-window","record":{"kind":"subscription","id":"codex-main","href":"https://llm.gmac.io/?recordKind=subscription&recordId=codex-main"}}';
    const request = new Request("https://bob.example.com/api/v1/hermes/notifications", {
      method: "POST",
      headers: {
        "x-skillfleet-timestamp": "1787234430",
        "x-skillfleet-signature":
          "sha256=35521e984f65adb2cb37fca66fa391d8a57993c3afd4ed85b061774afda243e9",
      },
      body,
    });
    const response = await handleSkillfleetNotification(request, {
      now: () => new Date("2026-08-20T14:00:30.000Z"),
      ingressSecret: "shared-ingress-secret",
      hermesOrigin: "https://claude.example.com",
      hermesOriginToken: ORIGIN_TOKEN,
      ledger: ledger(),
      fetch: hermesFetch(),
    });
    expect(response.status).toBe(201);
  });

  it("rejects missing, invalid, and stale signatures before touching the ledger", async () => {
    const deliveryLedger = ledger();
    const unsigned = new Request("https://bob.example.com/api/v1/hermes/notifications", {
      method: "POST",
      body: JSON.stringify(envelope()),
    });
    expect((await run(unsigned, { ledger: deliveryLedger })).status).toBe(401);

    const invalid = signedRequest();
    invalid.headers.set("x-skillfleet-signature", "sha256=00");
    expect((await run(invalid, { ledger: deliveryLedger })).status).toBe(401);

    const stale = signedRequest(envelope(), new Date(NOW.getTime() - 301_000));
    expect((await run(stale, { ledger: deliveryLedger })).status).toBe(401);
    expect(deliveryLedger.claim).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, unsafe record links, and malformed JSON", async () => {
    expect((await run(signedRequest(envelope({ surprise: true })))).status).toBe(400);
    expect(
      (
        await run(
          signedRequest(
            envelope({ record: { kind: "record", id: "one", href: "http://unsafe.example.com" } }),
          ),
        )
      ).status,
    ).toBe(400);

    const body = "{";
    const seconds = Math.floor(NOW.getTime() / 1000).toString();
    const signature = createHmac("sha256", SECRET).update(`${seconds}.${body}`).digest("hex");
    const malformed = new Request("https://bob.example.com/api/v1/hermes/notifications", {
      method: "POST",
      headers: {
        "x-skillfleet-timestamp": seconds,
        "x-skillfleet-signature": `sha256=${signature}`,
      },
      body,
    });
    expect((await run(malformed)).status).toBe(400);
  });

  it("creates one deterministic Hermes Telegram job and marks the claim processed", async () => {
    const deliveryLedger = ledger();
    const fetch = hermesFetch();
    const response = await run(signedRequest(), { ledger: deliveryLedger, fetch });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: "job-created" });
    expect(deliveryLedger.claim).toHaveBeenCalledWith(
      "urgent:skill-install-failed:machine-1",
      envelope(),
    );
    expect(deliveryLedger.markProcessed).toHaveBeenCalledWith(
      "urgent:skill-install-failed:machine-1",
    );
    const createCall = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      name: "skillfleet:urgent:skill-install-failed:machine-1",
      deliver: "telegram",
      schedule: "2026-08-21T16:01:00.000Z",
    });
    expect(body.prompt).toContain("machine-missing-required-skill");
    expect(body.prompt).not.toContain("/Volumes/");
  });

  it("reconciles an existing Hermes job instead of creating a duplicate", async () => {
    const deliveryLedger = ledger();
    const fetch = hermesFetch({ existing: true });
    const response = await run(signedRequest(), { ledger: deliveryLedger, fetch });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deduplicated: true,
      jobId: "job-1",
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(deliveryLedger.markProcessed).toHaveBeenCalled();
  });

  it.each([
    ["processed", 200, { ok: true, deduplicated: true }],
    ["pending", 202, { ok: true, pending: true }],
    ["conflict", 409, { error: "idempotency_conflict" }],
  ] as const)("handles a %s ledger claim without calling Hermes", async (claim, status, body) => {
    const fetch = hermesFetch();
    const response = await run(signedRequest(), {
      ledger: ledger(vi.fn().mockResolvedValue(claim)),
      fetch,
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(body);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects delivery when Hermes has no configured Telegram home target", async () => {
    const deliveryLedger = ledger();
    const response = await run(signedRequest(), {
      ledger: deliveryLedger,
      fetch: hermesFetch({ targets: { targets: [{ id: "telegram", home_target_set: false }] } }),
    });
    expect(response.status).toBe(503);
    expect(deliveryLedger.markFailed).toHaveBeenCalledWith(
      "urgent:skill-install-failed:machine-1",
      "Hermes Telegram delivery target is unavailable",
    );
  });

  it("returns a redacted retryable error and marks upstream failures", async () => {
    const deliveryLedger = ledger();
    const response = await run(signedRequest(), {
      ledger: deliveryLedger,
      fetch: vi.fn().mockResolvedValue(new Response("secret upstream detail", { status: 500 })),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "hermes_unavailable" });
    expect(deliveryLedger.markFailed).toHaveBeenCalled();
  });
});

describe("Hermes delivery ledger", () => {
  function repository(
    overrides: Partial<DeliveryRepository> = {},
  ): DeliveryRepository {
    return {
      insert: vi.fn().mockResolvedValue(true),
      find: vi.fn().mockResolvedValue(undefined),
      reclaim: vi.fn().mockResolvedValue(true),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("returns new when the unique delivery row is inserted", async () => {
    const repo = repository();
    const deliveryLedger = createDeliveryLedger(repo, () => NOW);
    await expect(
      deliveryLedger.claim("key", envelope() as SkillfleetNotification),
    ).resolves.toBe("new");
    expect(repo.find).not.toHaveBeenCalled();
  });

  it("rejects a reused idempotency key with a different payload", async () => {
    const repo = repository({
      insert: vi.fn().mockResolvedValue(false),
      find: vi.fn().mockResolvedValue({
        payload: envelope({ consequence: "different-consequence" }),
        status: "processed",
        receivedAt: NOW.toISOString(),
      }),
    });
    await expect(
      createDeliveryLedger(repo, () => NOW).claim(
        "key",
        envelope() as SkillfleetNotification,
      ),
    ).resolves.toBe("conflict");
  });

  it.each([
    ["processed", NOW.toISOString(), "processed"],
    ["pending", NOW.toISOString(), "pending"],
    ["failed", NOW.toISOString(), "retry"],
    ["pending", new Date(NOW.getTime() - 301_000).toISOString(), "retry"],
  ] as const)("maps %s received at %s to %s", async (status, receivedAt, expected) => {
    const repo = repository({
      insert: vi.fn().mockResolvedValue(false),
      find: vi.fn().mockResolvedValue({ payload: envelope(), status, receivedAt }),
    });
    await expect(
      createDeliveryLedger(repo, () => NOW).claim(
        "key",
        envelope() as SkillfleetNotification,
      ),
    ).resolves.toBe(expected);
    expect(repo.reclaim).toHaveBeenCalledTimes(expected === "retry" ? 1 : 0);
  });

  it("leaves a retry pending when another request wins the reclaim race", async () => {
    const repo = repository({
      insert: vi.fn().mockResolvedValue(false),
      find: vi.fn().mockResolvedValue({
        payload: envelope(),
        status: "failed",
        receivedAt: NOW.toISOString(),
      }),
      reclaim: vi.fn().mockResolvedValue(false),
    });
    await expect(
      createDeliveryLedger(repo, () => NOW).claim(
        "key",
        envelope() as SkillfleetNotification,
      ),
    ).resolves.toBe("pending");
  });
});

describe("Hermes origin service authorization", () => {
  it("accepts only an exact bearer credential", () => {
    expect(verifyOriginAuthorization(`Bearer ${ORIGIN_TOKEN}`, ORIGIN_TOKEN)).toBe(true);
    expect(verifyOriginAuthorization(null, ORIGIN_TOKEN)).toBe(false);
    expect(verifyOriginAuthorization("Basic nope", ORIGIN_TOKEN)).toBe(false);
    expect(verifyOriginAuthorization(`Bearer ${ORIGIN_TOKEN}x`, ORIGIN_TOKEN)).toBe(false);
  });

  it("limits the service credential to bootstrap and cron delivery endpoints", () => {
    expect(isAllowedHermesServiceRequest("GET", "/hermes/")).toBe(true);
    expect(isAllowedHermesServiceRequest("GET", "/hermes/api/cron/delivery-targets")).toBe(true);
    expect(isAllowedHermesServiceRequest("GET", "/hermes/api/cron/jobs?profile=default")).toBe(true);
    expect(isAllowedHermesServiceRequest("POST", "/hermes/api/cron/jobs?profile=default")).toBe(true);
    expect(isAllowedHermesServiceRequest("DELETE", "/hermes/api/cron/jobs/job-1")).toBe(false);
    expect(isAllowedHermesServiceRequest("GET", "/hermes/api/config")).toBe(false);
    expect(isAllowedHermesServiceRequest("GET", "/hermes/../api/config")).toBe(false);
  });
});

import { createHmac, timingSafeEqual } from "node:crypto";

import type { PlanningControlConfig } from "./planningControlConfig";

export const KANBANGER_CONTROL_SIGNATURE_HEADER = "x-kanbanger-signature";
export const KANBANGER_CONTROL_TIMESTAMP_HEADER = "x-kanbanger-timestamp";
export const KANBANGER_CONTROL_IDEMPOTENCY_HEADER = "idempotency-key";
export const PLANNING_CONTROL_SIGNATURE_HEADER = "x-planning-signature";
export const PLANNING_CONTROL_TIMESTAMP_HEADER = "x-planning-timestamp";

export interface PlanningControlSignatureInput {
  method: string;
  path: string;
  timestamp: string;
  idempotencyKey: string;
  body: string;
}

export interface PlanningControlRequestLike {
  method: string;
  path: string;
  body: string;
  headers: Headers | Record<string, string | null | undefined>;
}

export interface VerifiedPlanningControlRequest {
  timestamp: string;
  idempotencyKey: string;
}

export class PlanningControlAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code: string; status: number }) {
    super(message);
    this.name = "PlanningControlAuthError";
    this.code = options.code;
    this.status = options.status;
  }
}

function getCanonicalPath(input: string): string {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const url = new URL(input);
    return `${url.pathname}${url.search}`;
  }

  return input.startsWith("/") ? input : `/${input}`;
}

function buildPlanningControlCanonicalString(
  input: PlanningControlSignatureInput,
): string {
  return [
    input.method.toUpperCase(),
    getCanonicalPath(input.path),
    input.timestamp,
    input.idempotencyKey,
    input.body,
  ].join("\n");
}

export function buildPlanningControlSignature(
  input: PlanningControlSignatureInput,
  secret: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(buildPlanningControlCanonicalString(input), "utf8")
    .digest("hex");
  return `sha256=${digest}`;
}

function getHeader(
  headers: Headers | Record<string, string | null | undefined>,
  key: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }

  const exact = headers[key];
  if (exact !== undefined && exact !== null) {
    return exact;
  }

  const matchedEntry = Object.entries(headers).find(
    ([headerKey]) => headerKey.toLowerCase() === key.toLowerCase(),
  );

  return matchedEntry?.[1] ?? null;
}

function requireHeader(
  headers: Headers | Record<string, string | null | undefined>,
  key: string | string[],
  code: string,
  message: string,
): string {
  const keys = Array.isArray(key) ? key : [key];
  const value = keys.map((header) => getHeader(headers, header)?.trim()).find(Boolean);

  if (!value) {
    throw new PlanningControlAuthError(message, {
      code,
      status: 400,
    });
  }

  return value;
}

function verifySignature(
  expected: string,
  actual: string,
): boolean {
  try {
    return timingSafeEqual(
      Buffer.from(actual, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}

export function verifyPlanningControlRequest(
  request: PlanningControlRequestLike,
  config: PlanningControlConfig,
  deps: {
    now?: () => number;
  } = {},
): VerifiedPlanningControlRequest {
  const timestamp = requireHeader(
    request.headers,
    [KANBANGER_CONTROL_TIMESTAMP_HEADER, PLANNING_CONTROL_TIMESTAMP_HEADER],
    "MISSING_TIMESTAMP",
    "Missing planning control timestamp header",
  );
  const idempotencyKey = requireHeader(
    request.headers,
    KANBANGER_CONTROL_IDEMPOTENCY_HEADER,
    "MISSING_IDEMPOTENCY_KEY",
    "Missing Kanbanger control idempotency key",
  );
  const signature = requireHeader(
    request.headers,
    [KANBANGER_CONTROL_SIGNATURE_HEADER, PLANNING_CONTROL_SIGNATURE_HEADER],
    "MISSING_SIGNATURE",
    "Missing planning control signature",
  );

  const timestampMs = Number(timestamp);

  if (!Number.isFinite(timestampMs)) {
    throw new PlanningControlAuthError(
      "Invalid planning control timestamp",
      {
        code: "INVALID_TIMESTAMP",
        status: 400,
      },
    );
  }

  const now = deps.now ?? Date.now;
  if (Math.abs(now() - timestampMs) > config.maxSkewMs) {
    throw new PlanningControlAuthError("Stale planning control request", {
      code: "STALE_REQUEST",
      status: 401,
    });
  }

  const expectedSignature = buildPlanningControlSignature(
    {
      method: request.method,
      path: request.path,
      timestamp,
      idempotencyKey,
      body: request.body,
    },
    config.sharedSecret,
  );

  if (!verifySignature(expectedSignature, signature)) {
    throw new PlanningControlAuthError(
      "Invalid planning control signature",
      {
        code: "INVALID_SIGNATURE",
        status: 401,
      },
    );
  }

  return {
    timestamp,
    idempotencyKey,
  };
}

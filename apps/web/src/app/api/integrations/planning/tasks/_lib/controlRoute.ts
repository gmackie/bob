import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { ZodError } from "zod";

import { getPlanningControlConfig } from "@bob/api/services/integrations/planningControlConfig";
import { verifyPlanningControlRequest } from "@bob/api/services/integrations/planningControlVerifier";

interface SignedJsonRequestResult<T> {
  payload: T;
  requestId: {
    timestamp: string;
    idempotencyKey: string;
  };
}

interface SignedQueryRequestResult {
  requestId: {
    timestamp: string;
    idempotencyKey: string;
  };
}

interface ControlAuthError {
  status: number;
  code: string;
  message: string;
}

class ControlRouteResponseError extends Error {
  readonly response: NextResponse;

  constructor(response: NextResponse) {
    super("Planning control route response error");
    this.name = "ControlRouteResponseError";
    this.response = response;
  }
}

function getRequestPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function isControlAuthError(
  error: unknown,
): error is ControlAuthError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export async function parseSignedJsonRequest<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<SignedJsonRequestResult<T>> {
  const body = await request.text();
  const config = getPlanningControlConfig();
  const requestId = verifyPlanningControlRequest(
    {
      method: request.method,
      path: getRequestPath(request),
      headers: request.headers,
      body,
    },
    config,
  );

  let json: unknown;
  try {
    json = body ? (JSON.parse(body) as unknown) : {};
  } catch {
    throw new ControlRouteResponseError(
      NextResponse.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON request body",
          },
        },
        { status: 400 },
      ),
    );
  }

  return {
    payload: schema.parse(json),
    requestId,
  };
}

export function verifySignedQueryRequest(
  request: Request,
): SignedQueryRequestResult {
  const config = getPlanningControlConfig();
  const requestId = verifyPlanningControlRequest(
    {
      method: request.method,
      path: getRequestPath(request),
      headers: request.headers,
      body: "",
    },
    config,
  );

  return { requestId };
}

export function respondWithControlError(error: unknown): NextResponse {
  if (error instanceof ControlRouteResponseError) {
    return error.response;
  }

  if (isControlAuthError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PAYLOAD",
          message: "Invalid planning control payload",
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unknown planning control route error",
      },
    },
    { status: 500 },
  );
}

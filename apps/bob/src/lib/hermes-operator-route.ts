import { parseHermesOperatorIntent } from "@gmacko/bob/contracts";

import { HermesIntentUnavailableError } from "./hermes-operator";

type HermesOperatorPermission = "read" | "write" | "delete" | "admin";

export interface HermesOperatorRouteAuth {
  keyId: string;
  userId: string;
  permissions: HermesOperatorPermission[];
}

interface HermesOperatorRouteDependencies {
  authenticate(token: string): Promise<HermesOperatorRouteAuth | null>;
  authorize?(auth: HermesOperatorRouteAuth): boolean;
  createService(auth: HermesOperatorRouteAuth): {
    handle(input: unknown): Promise<unknown>;
  };
}

export class HermesOperatorUnavailableError extends Error {
  readonly name = "HermesOperatorUnavailableError";
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

function hasPermission(
  auth: HermesOperatorRouteAuth,
  permission: "read" | "write",
): boolean {
  return (
    auth.permissions.includes("admin") || auth.permissions.includes(permission)
  );
}

export async function handleHermesOperatorRequest(
  request: Request,
  dependencies: HermesOperatorRouteDependencies,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const auth = await dependencies.authenticate(token);
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (dependencies.authorize && !dependencies.authorize(auth)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let intent;
  try {
    intent = parseHermesOperatorIntent(await request.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const requiredPermission = intent.intent === "capture" ? "write" : "read";
  if (!hasPermission(auth, requiredPermission)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    return Response.json(await dependencies.createService(auth).handle(intent));
  } catch (error) {
    if (error instanceof HermesOperatorUnavailableError) {
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    }
    if (error instanceof HermesIntentUnavailableError) {
      return Response.json(
        { error: "intent_unavailable", intent: error.intent },
        { status: 501 },
      );
    }
    console.error("[hermes-operator] dependency failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "dependency_failed" }, { status: 502 });
  }
}

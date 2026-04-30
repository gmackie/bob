import type { Auth } from "./index";
import type { AuthRuntimeBundle } from "./runtime";
import {
  isApiKey,
  type ApiKeyAuth,
  validateApiKey,
} from "./api-key";
import { validateSessionToken } from "./session";

export interface WorkspaceSelection {
  projectId: string | null;
  workspaceId: string | null;
}

export interface RequestAuthContext {
  apiKeyAuth: ApiKeyAuth | null;
  authMethod: "session" | "api_key" | "default_user" | "none";
  session:
    | Awaited<ReturnType<Auth["api"]["getSession"]>>
    | {
        session: null;
        user: {
          id: string;
          email: string;
          name: string;
          emailVerified: boolean;
          image: string | null;
          createdAt: Date;
          updatedAt: Date;
        };
      }
    | null;
  workspace: WorkspaceSelection;
}

const DEFAULT_USER_ID = "default-user";

function readHeader(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveWorkspaceSelection(headers: Headers): WorkspaceSelection {
  return {
    workspaceId: readHeader(headers, "x-workspace-id"),
    projectId: readHeader(headers, "x-project-id"),
  };
}

export async function resolveRequestAuthContext(opts: {
  auth: Auth;
  defaultUser?:
    | (RequestAuthContext["session"] extends infer T ? Exclude<T, null> : never)
    | null;
  headers: Headers;
}): Promise<RequestAuthContext> {
  const authHeader = opts.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (bearerToken && isApiKey(bearerToken)) {
    const apiKeyAuth = await validateApiKey(bearerToken);
    if (apiKeyAuth) {
      return {
        apiKeyAuth,
        authMethod: "api_key",
        session: {
          session: null,
          user: apiKeyAuth.user,
        },
        workspace: resolveWorkspaceSelection(opts.headers),
      };
    }
  }

  const session = await opts.auth.api.getSession({
    headers: opts.headers,
  });

  if (session?.user) {
    return {
      apiKeyAuth: null,
      authMethod: "session",
      session,
      workspace: resolveWorkspaceSelection(opts.headers),
    };
  }

  if (bearerToken && !isApiKey(bearerToken)) {
    const validated = await validateSessionToken(bearerToken);
    if (validated) {
      return {
        apiKeyAuth: null,
        authMethod: "session",
        session: {
          session: validated.session,
          user: validated.user,
        },
        workspace: resolveWorkspaceSelection(opts.headers),
      };
    }
  }

  if (process.env.REQUIRE_AUTH !== "true") {
    return {
      apiKeyAuth: null,
      authMethod: "default_user",
      session: opts.defaultUser ?? null,
      workspace: resolveWorkspaceSelection(opts.headers),
    };
  }

  return {
    apiKeyAuth: null,
    authMethod: "none",
    session: null,
    workspace: resolveWorkspaceSelection(opts.headers),
  };
}

// ---------------------------------------------------------------------------
// Effect-bridge equivalent (Phase 7B-3 Task 3)
// ---------------------------------------------------------------------------
//
// `resolveAuthContext()` is the new entry-point for creating `RequestAuthContext`
// from an `AuthRuntimeBundle` (which holds the raw better-auth instance).
//
// It preserves the EXACT same `RequestAuthContext` shape so all 370+ tRPC tests
// pass unchanged. The key insight: we call `authInstance.api.getSession()` for
// the session path (giving us the full better-auth session shape) rather than
// `Sessions.validateRequest()` (which returns the narrower gmacko shape).
//
// API-key resolution still uses Bob's existing `validateApiKey()` + `isApiKey()`
// — Task 4 will retire those.
//
// The OLD `resolveRequestAuthContext()` above is kept for now so existing tests
// in `@bob/auth` that import it directly continue to work. Task 4 deletes it.

/**
 * Resolve auth context using the Effect auth runtime bridge.
 *
 * This is the bridge-aware replacement for `resolveRequestAuthContext()`.
 * It uses the `authInstance` from `createAuthRuntime()` to call
 * `authInstance.api.getSession({ headers })` — preserving the full
 * better-auth session shape that Bob's tRPC tests rely on.
 */
export async function resolveAuthContext(opts: {
  authBundle: AuthRuntimeBundle;
  defaultUser?:
    | (RequestAuthContext["session"] extends infer T ? Exclude<T, null> : never)
    | null;
  headers: Headers;
}): Promise<RequestAuthContext> {
  const authHeader = opts.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  // 1. API key path — same as before.
  if (bearerToken && isApiKey(bearerToken)) {
    const apiKeyAuth = await validateApiKey(bearerToken);
    if (apiKeyAuth) {
      return {
        apiKeyAuth,
        authMethod: "api_key",
        session: {
          session: null,
          user: apiKeyAuth.user,
        },
        workspace: resolveWorkspaceSelection(opts.headers),
      };
    }
  }

  // 2. Cookie/header session — use the raw better-auth instance from the bundle.
  const session = await opts.authBundle.authInstance.api.getSession({
    headers: opts.headers,
  });

  if (session?.user) {
    return {
      apiKeyAuth: null,
      authMethod: "session",
      session,
      workspace: resolveWorkspaceSelection(opts.headers),
    };
  }

  // 3. Bearer token session fallback.
  if (bearerToken && !isApiKey(bearerToken)) {
    const validated = await validateSessionToken(bearerToken);
    if (validated) {
      return {
        apiKeyAuth: null,
        authMethod: "session",
        session: {
          session: validated.session,
          user: validated.user,
        },
        workspace: resolveWorkspaceSelection(opts.headers),
      };
    }
  }

  // 4. Default user fallback.
  if (process.env.REQUIRE_AUTH !== "true") {
    return {
      apiKeyAuth: null,
      authMethod: "default_user",
      session: opts.defaultUser ?? null,
      workspace: resolveWorkspaceSelection(opts.headers),
    };
  }

  // 5. No auth.
  return {
    apiKeyAuth: null,
    authMethod: "none",
    session: null,
    workspace: resolveWorkspaceSelection(opts.headers),
  };
}

export { DEFAULT_USER_ID };

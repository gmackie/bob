import type { AuthRuntimeBundle } from "./runtime";
import {
  isApiKey,

  validateApiKey
} from "./api-key";
import type {ApiKeyAuth} from "./api-key";

export interface WorkspaceSelection {
  projectId: string | null;
  workspaceId: string | null;
}

export interface RequestAuthContext {
  apiKeyAuth: ApiKeyAuth | null;
  authMethod: "session" | "api_key" | "default_user" | "none";
  session:
    | Awaited<ReturnType<AuthRuntimeBundle["authInstance"]["api"]["getSession"]>>
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
const AUTH_BYPASS_TOKEN_PREFIX = "bob-auth-bypass:";

function readHeader(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getConfiguredAuthBypassUserId(): string {
  const configured = process.env.BOB_AUTH_BYPASS_USER_ID?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_USER_ID;
}

function getConfiguredAuthBypassToken(): string | null {
  const configured = process.env.BOB_AUTH_BYPASS_TOKEN?.trim();
  return configured && configured.length > 0 ? configured : null;
}

function extractAuthBypassToken(value: string | null): string | null {
  if (!value) return null;

  for (const part of value.split(";")) {
    const trimmed = part.trim();
    const candidates = [trimmed];

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      candidates.push(trimmed.slice(equalsIndex + 1).trim());
    }

    for (const candidate of candidates) {
      if (!candidate.startsWith(AUTH_BYPASS_TOKEN_PREFIX)) continue;

      const token = candidate.slice(AUTH_BYPASS_TOKEN_PREFIX.length).trim();
      return token.length > 0 ? token : null;
    }
  }

  return null;
}

export function resolveAuthBypassUserId(headers: Headers): string | null {
  if (process.env.BOB_AUTH_BYPASS !== "true") {
    return null;
  }

  const configuredToken = getConfiguredAuthBypassToken();
  if (!configuredToken) return null;

  const authHeader = readHeader(headers, "authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const requestedToken =
    extractAuthBypassToken(bearerToken) ??
    extractAuthBypassToken(readHeader(headers, "cookie"));

  if (!requestedToken || requestedToken !== configuredToken) return null;

  return getConfiguredAuthBypassUserId();
}

export function resolveWorkspaceSelection(headers: Headers): WorkspaceSelection {
  return {
    workspaceId: readHeader(headers, "x-workspace-id"),
    projectId: readHeader(headers, "x-project-id"),
  };
}

// ---------------------------------------------------------------------------
// resolveAuthContext — the single entry-point for creating RequestAuthContext.
//
// Uses the `authInstance` from `AuthRuntimeBundle` to call
// `authInstance.api.getSession({ headers })` — preserving the full
// better-auth session shape that Bob's tRPC tests rely on.
//
// The old `resolveRequestAuthContext()` and the bearer-token fallback via
// `validateSessionToken()` have been retired (Phase 7B-3 Task 4). Cookie
// and Authorization header session resolution are both handled by
// better-auth's `getSession()`.
// ---------------------------------------------------------------------------

/**
 * Resolve auth context using the Effect auth runtime bridge.
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

  // 1. API key path.
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

  // 2. Explicit auth bypass for production-targeted internal mobile builds.
  // The token is only accepted for the configured single user and still
  // requires the caller to provide that user's loaded record as defaultUser.
  const authBypassUserId = resolveAuthBypassUserId(opts.headers);
  if (
    authBypassUserId &&
    opts.defaultUser?.user.id === authBypassUserId
  ) {
    return {
      apiKeyAuth: null,
      authMethod: "default_user",
      session: opts.defaultUser,
      workspace: resolveWorkspaceSelection(opts.headers),
    };
  }

  // 3. Cookie/header session — better-auth handles both cookie-based and
  //    Authorization-header-based session resolution internally.
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

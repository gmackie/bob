import type { AuthRuntimeBundle } from "./runtime";
import {
  isApiKey,
  type ApiKeyAuth,
  validateApiKey,
} from "./api-key";

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

  // 2. Cookie/header session — better-auth handles both cookie-based and
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

  // 3. Default user fallback.
  if (process.env.REQUIRE_AUTH !== "true") {
    return {
      apiKeyAuth: null,
      authMethod: "default_user",
      session: opts.defaultUser ?? null,
      workspace: resolveWorkspaceSelection(opts.headers),
    };
  }

  // 4. No auth.
  return {
    apiKeyAuth: null,
    authMethod: "none",
    session: null,
    workspace: resolveWorkspaceSelection(opts.headers),
  };
}

export { DEFAULT_USER_ID };

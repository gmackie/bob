import type { Auth } from "./index";
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
  defaultUser: RequestAuthContext["session"] extends infer T
    ? Exclude<T, null>
    : never;
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

export { DEFAULT_USER_ID };

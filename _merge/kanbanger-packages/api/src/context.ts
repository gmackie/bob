import { createDb, type Database, type User, users } from "@linear-clone/db";
import { validateApiKey } from "@linear-clone/auth/api-key";
import { validateSession } from "@linear-clone/auth/session";
import { eq } from "drizzle-orm";

const BETA_AUTH_BYPASS = process.env.BETA_AUTH_BYPASS === "true";
const BETA_TEST_USER_ID = process.env.BETA_TEST_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const BETA_TEST_USER_EMAIL = process.env.BETA_TEST_USER_EMAIL ?? "beta@tasks.gmac.io";

export interface Context {
  userId: string | null;
  user: User | null;
  db: Database;
  scopes: string[];
  authMethod: "session" | "api_key" | "beta_bypass" | "none";
}

interface CreateContextOptions {
  req: {
    headers: {
      authorization?: string;
      cookie?: string;
      "x-api-key"?: string;
      "x-beta-auth-bypass"?: string;
      "x-beta-user-id"?: string;
    };
    cookies?: {
      get: (name: string) => { value: string } | undefined;
    };
  };
  sessionUserId?: string | null;
  sessionUser?: User | null;
}

export async function createContext({
  req,
  sessionUserId,
  sessionUser,
}: CreateContextOptions): Promise<Context> {
  const db = createDb();
  const sessionToken = req.cookies?.get?.("session_token")?.value;
  const betaBypassCookie = req.cookies?.get?.("beta_auth_bypass")?.value;
  const betaUserIdCookie = req.cookies?.get?.("beta_user_id")?.value;
  const betaBypassRequested =
    BETA_AUTH_BYPASS &&
    (
      req.headers["x-beta-auth-bypass"] === "true" ||
      betaBypassCookie === "true" ||
      (!sessionToken && !req.headers.authorization && !req.headers["x-api-key"])
    );

  // Priority 0: Beta auth bypass for e2e testing
  if (betaBypassRequested) {
    const betaUserId = req.headers["x-beta-user-id"] ?? betaUserIdCookie ?? BETA_TEST_USER_ID;
    let betaUser = await db.query.users.findFirst({
      where: eq(users.email, BETA_TEST_USER_EMAIL),
    });
    
    if (!betaUser) {
      const [newUser] = await db.insert(users).values({
        id: betaUserId,
        email: BETA_TEST_USER_EMAIL,
        name: "Beta Test User",
      }).returning();
      betaUser = newUser;
    }
    
    if (betaUser) {
      return {
        userId: betaUser.id,
        user: betaUser,
        db,
        scopes: ["read", "write", "admin"],
        authMethod: "beta_bypass",
      };
    }
  }

  // Priority 1: Pre-authenticated session (from middleware)
  if (sessionUserId && sessionUser) {
    return {
      userId: sessionUserId,
      user: sessionUser,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    };
  }

  // Priority 2: API Key authentication (for MCP/LLM agents)
  const apiKey = req.headers["x-api-key"] || req.headers.authorization?.replace("Bearer ", "");
  if (apiKey?.startsWith("lc_")) {
    const validation = await validateApiKey(db, apiKey);
    if (validation.valid && validation.user) {
      return {
        userId: validation.user.id,
        user: validation.user,
        db,
        scopes: validation.scopes ?? ["read"],
        authMethod: "api_key",
      };
    }
  }

  // Priority 3: Bearer session token (for mobile)
  const bearerToken = req.headers.authorization?.replace("Bearer ", "");
  if (bearerToken && !bearerToken.startsWith("lc_")) {
    const validation = await validateSession(db, bearerToken);
    if (validation.valid && validation.user) {
      return {
        userId: validation.user.id,
        user: validation.user,
        db,
        scopes: ["read", "write", "admin"],
        authMethod: "session",
      };
    }
  }

  // Priority 4: Session cookie
  if (sessionToken) {
    const validation = await validateSession(db, sessionToken);
    if (validation.valid && validation.user) {
      return {
        userId: validation.user.id,
        user: validation.user,
        db,
        scopes: ["read", "write", "admin"],
        authMethod: "session",
      };
    }
  }

  // No authentication
  return {
    userId: null,
    user: null,
    db,
    scopes: [],
    authMethod: "none",
  };
}

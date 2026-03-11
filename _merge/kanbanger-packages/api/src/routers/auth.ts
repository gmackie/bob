import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { users, sessions, workspaces, workspaceMembers, type Database } from "@linear-clone/db";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import {
  getEntraAuthUrl,
  exchangeEntraCode,
  getEntraUserInfo,
  type EntraConfig,
} from "@linear-clone/auth/oauth/entra";
import {
  getGitHubAuthUrl,
  exchangeGitHubCode,
  getGitHubUserInfo,
  type GitHubConfig,
} from "@linear-clone/auth/oauth/github";
import {
  getGiteaAuthUrl,
  exchangeGiteaCode,
  getGiteaUserInfo,
  type GiteaConfig,
} from "@linear-clone/auth/oauth/gitea";
import { createSession } from "@linear-clone/auth/session";
import { randomBytes } from "crypto";

// OAuth state storage (in production, use Redis or DB)
const oauthStates = new Map<string, { provider: string; returnUrl?: string; expiresAt: number }>();

async function ensureDefaultWorkspace(db: Database, userId: string, userName: string | null): Promise<void> {
  const [membershipCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  if ((membershipCount?.count ?? 0) > 0) {
    return;
  }

  const baseName = userName ? `${userName}'s Workspace` : "My Workspace";
  const baseSlug = userName
    ? userName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40)
    : "my-workspace";

  let slug = baseSlug;
  let attempt = 0;
  let created = false;

  while (!created && attempt < 10) {
    try {
      const [workspace] = await db
        .insert(workspaces)
        .values({
          name: attempt === 0 ? baseName : `${baseName} ${attempt + 1}`,
          slug: attempt === 0 ? slug : `${slug}-${attempt + 1}`,
          ownerId: userId,
        })
        .returning();

      if (workspace) {
        await db.insert(workspaceMembers).values({
          workspaceId: workspace.id,
          userId: userId,
          role: "admin",
        });
        created = true;
      }
    } catch {
      attempt++;
    }
  }
}

// Helper to clean expired states
function cleanExpiredStates() {
  const now = Date.now();
  for (const [key, value] of oauthStates) {
    if (value.expiresAt < now) {
      oauthStates.delete(key);
    }
  }
}

// Get OAuth configs from environment
function getEntraConfig(): EntraConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  const redirectUri = process.env.ENTRA_REDIRECT_URI;

  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { tenantId, clientId, clientSecret, redirectUri };
}

function getGitHubConfig(): GitHubConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

function getGiteaConfig(): GiteaConfig | null {
  const baseUrl = process.env.GITEA_BASE_URL;
  const clientId = process.env.GITEA_CLIENT_ID;
  const clientSecret = process.env.GITEA_CLIENT_SECRET;
  const redirectUri = process.env.GITEA_REDIRECT_URI;

  if (!baseUrl || !clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { baseUrl, clientId, clientSecret, redirectUri };
}

export const authRouter = router({
  // Get available auth providers
  providers: publicProcedure.query(() => {
    return {
      entra: !!getEntraConfig(),
      github: !!getGitHubConfig(),
      gitea: !!getGiteaConfig(),
    };
  }),

  // Get current session info
  session: protectedProcedure.query(async ({ ctx }) => {
    return {
      user: ctx.user,
      authMethod: ctx.authMethod,
      scopes: ctx.scopes,
    };
  }),

  // ================== OAuth Login URLs ==================

  // Get Entra ID login URL
  getEntraLoginUrl: publicProcedure
    .input(z.object({ returnUrl: z.string().optional() }))
    .query(({ input }) => {
      const config = getEntraConfig();
      if (!config) {
        throw new Error("Entra ID is not configured");
      }

      cleanExpiredStates();
      const state = randomBytes(32).toString("hex");
      oauthStates.set(state, {
        provider: "entra",
        returnUrl: input.returnUrl,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      });

      return { url: getEntraAuthUrl(config, state) };
    }),

  // Get GitHub login URL
  getGitHubLoginUrl: publicProcedure
    .input(z.object({ returnUrl: z.string().optional() }))
    .query(({ input }) => {
      const config = getGitHubConfig();
      if (!config) {
        throw new Error("GitHub OAuth is not configured");
      }

      cleanExpiredStates();
      const state = randomBytes(32).toString("hex");
      oauthStates.set(state, {
        provider: "github",
        returnUrl: input.returnUrl,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      return { url: getGitHubAuthUrl(config, state) };
    }),

  // Get Gitea login URL
  getGiteaLoginUrl: publicProcedure
    .input(z.object({ returnUrl: z.string().optional() }))
    .query(({ input }) => {
      const config = getGiteaConfig();
      if (!config) {
        throw new Error("Gitea OAuth is not configured");
      }

      cleanExpiredStates();
      const state = randomBytes(32).toString("hex");
      oauthStates.set(state, {
        provider: "gitea",
        returnUrl: input.returnUrl,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      return { url: getGiteaAuthUrl(config, state) };
    }),

  // ================== OAuth Callbacks ==================

  // Handle Entra ID callback
  handleEntraCallback: publicProcedure
    .input(z.object({ code: z.string(), state: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const config = getEntraConfig();
      if (!config) {
        throw new Error("Entra ID is not configured");
      }

      // Verify state
      const storedState = oauthStates.get(input.state);
      if (!storedState || storedState.provider !== "entra" || storedState.expiresAt < Date.now()) {
        throw new Error("Invalid or expired OAuth state");
      }
      oauthStates.delete(input.state);

      // Exchange code for tokens
      const tokens = await exchangeEntraCode(config, input.code);
      const userInfo = await getEntraUserInfo(tokens.access_token);

      // Verify @gmacko.com domain
      const email = userInfo.mail || userInfo.userPrincipalName;
      if (!email.endsWith("@gmacko.com")) {
        throw new Error("Only @gmacko.com users can sign in with Entra ID");
      }

      // Find or create user
      let [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.entraId, userInfo.id))
        .limit(1);

      if (!user) {
        // Check if user exists by email
        [user] = await ctx.db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (user) {
          // Link Entra ID to existing user
          [user] = await ctx.db
            .update(users)
            .set({ entraId: userInfo.id, lastLoginAt: new Date() })
            .where(eq(users.id, user.id))
            .returning();
        } else {
          // Create new user
          [user] = await ctx.db
            .insert(users)
            .values({
              email: email,
              name: userInfo.displayName,
              entraId: userInfo.id,
              isAdmin: true, // All Gmacko users are admins
              lastLoginAt: new Date(),
            })
            .returning();
        }
      } else {
        // Update last login
        await ctx.db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id));
      }

      if (!user) {
        throw new Error("Failed to create or find user");
      }

      await ensureDefaultWorkspace(ctx.db, user.id, user.name);

      const session = await createSession(ctx.db, user.id);

      return {
        sessionToken: session.sessionToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        returnUrl: storedState.returnUrl,
      };
    }),

  // Handle GitHub callback
  handleGitHubCallback: publicProcedure
    .input(z.object({ code: z.string(), state: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const config = getGitHubConfig();
      if (!config) {
        throw new Error("GitHub OAuth is not configured");
      }

      // Verify state
      const storedState = oauthStates.get(input.state);
      if (!storedState || storedState.provider !== "github" || storedState.expiresAt < Date.now()) {
        throw new Error("Invalid or expired OAuth state");
      }
      oauthStates.delete(input.state);

      // Exchange code for tokens
      const tokens = await exchangeGitHubCode(config, input.code);
      const userInfo = await getGitHubUserInfo(tokens.access_token);

      // Find existing user by GitHub ID
      let [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.githubId, String(userInfo.id)))
        .limit(1);

      if (user) {
        // Update GitHub access token and username
        [user] = await ctx.db
          .update(users)
          .set({
            githubAccessToken: tokens.access_token,
            githubUsername: userInfo.login,
            lastLoginAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning();
      } else {
        // Check if this is linking to existing user (by email)
        if (userInfo.email) {
          [user] = await ctx.db
            .select()
            .from(users)
            .where(eq(users.email, userInfo.email))
            .limit(1);

          if (user) {
            // Link GitHub to existing user
            [user] = await ctx.db
              .update(users)
              .set({
                githubId: String(userInfo.id),
                githubUsername: userInfo.login,
                githubAccessToken: tokens.access_token,
                lastLoginAt: new Date(),
              })
              .where(eq(users.id, user.id))
              .returning();
          }
        }

        // If still no user, create new one
        if (!user) {
          [user] = await ctx.db
            .insert(users)
            .values({
              email: userInfo.email ?? `${userInfo.login}@github.local`,
              name: userInfo.name ?? userInfo.login,
              avatarUrl: userInfo.avatar_url,
              githubId: String(userInfo.id),
              githubUsername: userInfo.login,
              githubAccessToken: tokens.access_token,
              lastLoginAt: new Date(),
            })
            .returning();
        }
      }

      if (!user) {
        throw new Error("Failed to create or find user");
      }

      await ensureDefaultWorkspace(ctx.db, user.id, user.name);

      const session = await createSession(ctx.db, user.id);

      return {
        sessionToken: session.sessionToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        returnUrl: storedState.returnUrl,
      };
    }),

  // Handle Gitea callback
  handleGiteaCallback: publicProcedure
    .input(z.object({ code: z.string(), state: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const config = getGiteaConfig();
      if (!config) {
        throw new Error("Gitea OAuth is not configured");
      }

      // Verify state
      const storedState = oauthStates.get(input.state);
      if (!storedState || storedState.provider !== "gitea" || storedState.expiresAt < Date.now()) {
        throw new Error("Invalid or expired OAuth state");
      }
      oauthStates.delete(input.state);

      // Exchange code for tokens
      const tokens = await exchangeGiteaCode(config, input.code);
      const userInfo = await getGiteaUserInfo(config, tokens.access_token);

      // Find existing user by Gitea ID
      let [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.giteaId, String(userInfo.id)))
        .limit(1);

      if (user) {
        // Update Gitea access token and username
        [user] = await ctx.db
          .update(users)
          .set({
            giteaAccessToken: tokens.access_token,
            giteaUsername: userInfo.login,
            lastLoginAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning();
      } else {
        // Check if this is linking to existing user (by email)
        if (userInfo.email) {
          [user] = await ctx.db
            .select()
            .from(users)
            .where(eq(users.email, userInfo.email))
            .limit(1);

          if (user) {
            // Link Gitea to existing user
            [user] = await ctx.db
              .update(users)
              .set({
                giteaId: String(userInfo.id),
                giteaUsername: userInfo.login,
                giteaAccessToken: tokens.access_token,
                lastLoginAt: new Date(),
              })
              .where(eq(users.id, user.id))
              .returning();
          }
        }

        // If still no user, create new one
        if (!user) {
          [user] = await ctx.db
            .insert(users)
            .values({
              email: userInfo.email,
              name: userInfo.full_name || userInfo.login,
              avatarUrl: userInfo.avatar_url,
              giteaId: String(userInfo.id),
              giteaUsername: userInfo.login,
              giteaAccessToken: tokens.access_token,
              lastLoginAt: new Date(),
            })
            .returning();
        }
      }

      if (!user) {
        throw new Error("Failed to create or find user");
      }

      await ensureDefaultWorkspace(ctx.db, user.id, user.name);

      const session = await createSession(ctx.db, user.id);

      return {
        sessionToken: session.sessionToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        returnUrl: storedState.returnUrl,
      };
    }),

  // ================== Session Management ==================

  // Logout
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // The session token should be available from the context
    // This would typically be passed through headers
    // For now, we'll delete all sessions for the user
    if (ctx.user) {
      await ctx.db.delete(sessions).where(eq(sessions.userId, ctx.user.id));
    }
    return { success: true };
  }),

  // ================== Link Additional OAuth Providers ==================

  // Link GitHub to existing account (for webhook setup)
  linkGitHub: protectedProcedure
    .input(z.object({ code: z.string(), state: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new Error("User not found");
      }

      const config = getGitHubConfig();
      if (!config) {
        throw new Error("GitHub OAuth is not configured");
      }

      // Verify state
      const storedState = oauthStates.get(input.state);
      if (!storedState || storedState.provider !== "github" || storedState.expiresAt < Date.now()) {
        throw new Error("Invalid or expired OAuth state");
      }
      oauthStates.delete(input.state);

      // Exchange code for tokens
      const tokens = await exchangeGitHubCode(config, input.code);
      const userInfo = await getGitHubUserInfo(tokens.access_token);

      // Update user with GitHub info
      const [user] = await ctx.db
        .update(users)
        .set({
          githubId: String(userInfo.id),
          githubUsername: userInfo.login,
          githubAccessToken: tokens.access_token,
        })
        .where(eq(users.id, ctx.user.id))
        .returning();

      return {
        success: true,
        githubUsername: user?.githubUsername,
      };
    }),

  // Link Gitea to existing account (for webhook setup)
  linkGitea: protectedProcedure
    .input(z.object({ code: z.string(), state: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new Error("User not found");
      }

      const config = getGiteaConfig();
      if (!config) {
        throw new Error("Gitea OAuth is not configured");
      }

      // Verify state
      const storedState = oauthStates.get(input.state);
      if (!storedState || storedState.provider !== "gitea" || storedState.expiresAt < Date.now()) {
        throw new Error("Invalid or expired OAuth state");
      }
      oauthStates.delete(input.state);

      // Exchange code for tokens
      const tokens = await exchangeGiteaCode(config, input.code);
      const userInfo = await getGiteaUserInfo(config, tokens.access_token);

      // Update user with Gitea info
      const [user] = await ctx.db
        .update(users)
        .set({
          giteaId: String(userInfo.id),
          giteaUsername: userInfo.login,
          giteaAccessToken: tokens.access_token,
        })
        .where(eq(users.id, ctx.user.id))
        .returning();

      return {
        success: true,
        giteaUsername: user?.giteaUsername,
      };
    }),
});

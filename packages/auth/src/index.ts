import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";

import { db } from "@bob/db/client";

export function initAuth<
  TExtraPlugins extends BetterAuthPlugin[] = [],
>(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;

  githubClientId: string;
  githubClientSecret: string;
  gitlabClientId?: string;
  gitlabClientSecret?: string;
  extraPlugins?: TExtraPlugins;
}) {
  const socialProviders: BetterAuthOptions["socialProviders"] = {
    github: {
      clientId: options.githubClientId,
      clientSecret: options.githubClientSecret,
      redirectURI: `${options.productionUrl}/api/auth/callback/github`,
      scope: ["user:email", "repo", "read:user"],
    },
  };

  if (options.gitlabClientId && options.gitlabClientSecret) {
    socialProviders.gitlab = {
      clientId: options.gitlabClientId,
      clientSecret: options.gitlabClientSecret,
      redirectURI: `${options.productionUrl}/api/auth/callback/gitlab`,
      scope: ["api", "read_user", "read_repository", "write_repository"],
    };
  }

  const config = {
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    plugins: [
      oAuthProxy({
        productionURL: options.productionUrl,
      }),
      expo(),
      ...(options.extraPlugins ?? []),
    ],
    socialProviders,
    trustedOrigins: Array.from(
      new Set(
        [
          "expo://",
          "bob://",
          "http://localhost:3000",
          options.baseUrl,
          options.productionUrl,
        ].filter(Boolean),
      ),
    ),
    onAPIError: {
      onError(error, ctx) {
        console.error("BETTER AUTH API ERROR", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];

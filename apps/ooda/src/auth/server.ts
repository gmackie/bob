import { initAuth } from "@gmacko/core/auth";
import { db } from "@gmacko/ooda/db/client";

export const auth = initAuth({
  db,
  pluralizeTables: true,
  baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  productionUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
});

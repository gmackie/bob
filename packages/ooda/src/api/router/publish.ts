import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publishDraft, listFiles } from "@gmacko/ooda/vault";

import { publicProcedure, authedProcedure } from "../trpc";

/**
 * Resolve PERSONAL_WEBSITE_PATH from the environment.
 * Throws TRPCError PRECONDITION_FAILED if not set.
 */
function getWebsitePath(): string {
  const path = process.env.PERSONAL_WEBSITE_PATH;
  if (!path || path.trim() === "") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: [
        "Publishing is not configured.",
        "Cause: Environment variable PERSONAL_WEBSITE_PATH is not set.",
        "Fix: Set PERSONAL_WEBSITE_PATH in .env to the absolute path of your personal website git clone.",
      ].join(" "),
    });
  }
  return path;
}

const siteSchema = z.enum(["gmacko", "grahammackie", "gmac"]);

export const publishRouter = {
  draft: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/publish/draft", tags: ["publish"], protect: true } })
    .input(
      z.object({
        title: z.string().min(1),
        content: z.string(),
        site: siteSchema,
        tags: z.array(z.string()).optional(),
        date: z.string().optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ input }) => {
      const websitePath = getWebsitePath();
      const filePath = await publishDraft(websitePath, {
        title: input.title,
        content: input.content,
        site: input.site,
        tags: input.tags,
        date: input.date,
      });
      return { filePath };
    }),

  listDrafts: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/publish/drafts", tags: ["publish"] } })
    .output(z.any())
    .query(async () => {
    const websitePath = getWebsitePath();
    const draftsPath = `${websitePath}/_drafts`;
    try {
      return await listFiles(draftsPath);
    } catch {
      // _drafts directory may not exist yet
      return [];
    }
  }),
} satisfies RouterRecord;

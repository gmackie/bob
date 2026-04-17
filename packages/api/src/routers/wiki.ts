import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { message } from "@gmacko/db";
import { dispatchAgent } from "@gmacko/agent";
import { writeArticle, buildIndex, findOrphanedArticles } from "@gmacko/wiki";

// Configurable vault path — defaults to ~/obsidian
const VAULT_PATH = process.env.VAULT_PATH ?? `${process.env.HOME}/obsidian`;

export const wikiRouter = {
  // "Write this up" — synthesize thread conversation into wiki article
  synthesize: publicProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        branchId: z.string().uuid(),
        title: z.string().min(1),
        tags: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Load messages from branch
      const messages = await ctx.db
        .select()
        .from(message)
        .where(
          and(
            eq(message.threadId, input.threadId),
            eq(message.branchId, input.branchId),
          ),
        )
        .orderBy(asc(message.createdAt));

      // 2. Send to Claude with synthesis prompt
      const conversationText = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");

      let articleContent = "";
      for await (const event of dispatchAgent({
        threadId: input.threadId,
        branchId: input.branchId,
        messages: [
          {
            role: "user",
            content: `Synthesize the following conversation into a well-structured wiki article. Use clear headings, concise paragraphs, and include key insights. Do not include conversation artifacts — write it as a standalone article.\n\nConversation:\n${conversationText}`,
          },
        ],
        systemPrompt:
          "You are a technical writer. Synthesize conversations into clear, well-structured wiki articles. Use markdown formatting with headings, lists, and emphasis where appropriate.",
      })) {
        if (event.type === "done") {
          articleContent = event.content;
        }
      }

      // 3. Generate slug from title
      const slug = input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // 4. Check existing wiki for related articles
      const existingIndex = await buildIndex(VAULT_PATH);
      const relatedSlugs = existingIndex
        .filter((a) => a.tags.some((t) => input.tags.includes(t)))
        .map((a) => a.slug)
        .slice(0, 5);

      // 5. Write article to vault
      const filePath = await writeArticle(VAULT_PATH, {
        title: input.title,
        slug,
        content: articleContent,
        tags: input.tags,
        sourceThreadId: input.threadId,
        sourceBranchIds: [input.branchId],
        relatedArticles: relatedSlugs,
      });

      return { filePath, slug, title: input.title };
    }),

  // List all wiki articles
  list: publicProcedure.query(async () => {
    return buildIndex(VAULT_PATH);
  }),

  // Find orphaned articles
  orphans: publicProcedure.query(async () => {
    const index = await buildIndex(VAULT_PATH);
    return findOrphanedArticles(index);
  }),
};

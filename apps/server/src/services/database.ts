import { Effect, Layer, ServiceMap } from "effect";
import { getDb } from "@gmacko/db/client";
import { thread, branch, message } from "@gmacko/db/schema";
import { eq } from "drizzle-orm";

type ThreadRow = typeof thread.$inferSelect;
type BranchRow = typeof branch.$inferSelect;
type MessageRow = typeof message.$inferSelect;

export class DatabaseService extends ServiceMap.Service<
  DatabaseService,
  {
    // Threads
    readonly listThreads: () => Effect.Effect<ThreadRow[], Error>;
    readonly getThreadById: (
      id: string,
    ) => Effect.Effect<ThreadRow | undefined, Error>;
    readonly createThread: (input: {
      title: string;
      tags?: string[];
    }) => Effect.Effect<ThreadRow, Error>;
    readonly updateThreadStatus: (input: {
      id: string;
      status: "active" | "paused" | "archived" | "completed";
    }) => Effect.Effect<ThreadRow | undefined, Error>;

    // Branches
    readonly listBranchesByThread: (
      threadId: string,
    ) => Effect.Effect<BranchRow[], Error>;
    readonly createBranch: (input: {
      threadId: string;
      parentBranchId: string;
      forkPointMessageId: string;
      name: string;
    }) => Effect.Effect<BranchRow, Error>;
    readonly setActiveBranch: (input: {
      threadId: string;
      branchId: string;
    }) => Effect.Effect<void, Error>;

    // Messages
    readonly listMessagesByBranch: (input: {
      threadId: string;
      branchId: string;
    }) => Effect.Effect<MessageRow[], Error>;
    readonly createMessage: (input: {
      threadId: string;
      branchId: string;
      parentId: string | null;
      role: "user" | "assistant" | "system";
      content: string;
      metadata?: Record<string, unknown>;
    }) => Effect.Effect<MessageRow, Error>;
  }
>()("@gmacko/server/DatabaseService") {}

export const DatabaseServiceLive = Layer.succeed(DatabaseService)({
  listThreads: () =>
    Effect.tryPromise({
      try: async () => (await getDb()).select().from(thread),
      catch: (error) => new Error(`Failed to list threads: ${error}`),
    }),

  getThreadById: (id: string) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = await db.select().from(thread).where(eq(thread.id, id));
        return rows[0];
      },
      catch: (error) => new Error(`Failed to get thread: ${error}`),
    }),

  createThread: (input) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = await db
          .insert(thread)
          .values({
            title: input.title,
            tags: input.tags ?? [],
          })
          .returning();
        return rows[0]!;
      },
      catch: (error) => new Error(`Failed to create thread: ${error}`),
    }),

  updateThreadStatus: (input) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = await db
          .update(thread)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(thread.id, input.id))
          .returning();
        return rows[0];
      },
      catch: (error) =>
        new Error(`Failed to update thread status: ${error}`),
    }),

  listBranchesByThread: (threadId: string) =>
    Effect.tryPromise({
      try: () =>
        db.select().from(branch).where(eq(branch.threadId, threadId)),
      catch: (error) => new Error(`Failed to list branches: ${error}`),
    }),

  createBranch: (input) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = await db
          .insert(branch)
          .values({
            threadId: input.threadId,
            parentBranchId: input.parentBranchId,
            forkPointMessageId: input.forkPointMessageId,
            name: input.name,
          })
          .returning();
        return rows[0]!;
      },
      catch: (error) => new Error(`Failed to create branch: ${error}`),
    }),

  setActiveBranch: (input) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        await db
          .update(thread)
          .set({ activeBranchId: input.branchId })
          .where(eq(thread.id, input.threadId));
      },
      catch: (error) =>
        new Error(`Failed to set active branch: ${error}`),
    }),

  listMessagesByBranch: (input) =>
    Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(message)
          .where(eq(message.branchId, input.branchId)),
      catch: (error) => new Error(`Failed to list messages: ${error}`),
    }),

  createMessage: (input) =>
    Effect.tryPromise({
      try: async () => {
        const db = await getDb();
        const rows = await db
          .insert(message)
          .values({
            threadId: input.threadId,
            branchId: input.branchId,
            parentId: input.parentId,
            role: input.role,
            content: input.content,
            metadata: input.metadata ?? {},
          })
          .returning();
        return rows[0]!;
      },
      catch: (error) => new Error(`Failed to create message: ${error}`),
    }),
});

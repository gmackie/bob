import { Effect } from "effect";
import {
  GmackoRpcGroup,
  ThreadNotFoundError,
  AgentError,
  WikiError,
} from "@gmacko/contracts";
import { DatabaseService } from "./services/database.js";
import { AgentService } from "./services/agent.js";
import { WikiService } from "./services/wiki.js";

/** Promote unexpected Error to a defect (die) so it doesn't pollute the error channel. */
const orDie = <A>(effect: Effect.Effect<A, Error>) =>
  Effect.orDie(effect);

export const RpcHandlerLayer = GmackoRpcGroup.toLayer(
  Effect.gen(function* () {
    const database = yield* DatabaseService;
    const agent = yield* AgentService;
    const wiki = yield* WikiService;

    return GmackoRpcGroup.of({
      "threads.list": () =>
        orDie(
          Effect.gen(function* () {
            const rows = yield* database.listThreads();
            return rows.map((r) => ({
              id: r.id,
              title: r.title,
              status: r.status,
              activeBranchId: r.activeBranchId,
              tags: [...(r.tags ?? [])] as string[],
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            }));
          }),
        ),

      "threads.byId": (payload) =>
        Effect.gen(function* () {
          const row = yield* orDie(database.getThreadById(payload.id));
          if (!row) {
            return yield* Effect.fail(
              new ThreadNotFoundError({
                id: payload.id,
                message: `Thread ${payload.id} not found`,
              }),
            );
          }
          return {
            id: row.id,
            title: row.title,
            status: row.status,
            activeBranchId: row.activeBranchId,
            tags: [...(row.tags ?? [])] as string[],
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),

      "threads.create": (payload) =>
        orDie(
          Effect.gen(function* () {
            const row = yield* database.createThread({
              title: payload.title,
              tags: [...payload.tags],
            });
            return {
              id: row.id,
              title: row.title,
              status: row.status,
              activeBranchId: row.activeBranchId,
              tags: [...(row.tags ?? [])] as string[],
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            };
          }),
        ),

      "threads.updateStatus": (payload) =>
        Effect.gen(function* () {
          const row = yield* orDie(
            database.updateThreadStatus({
              id: payload.id,
              status: payload.status,
            }),
          );
          if (!row) {
            return yield* Effect.fail(
              new ThreadNotFoundError({
                id: payload.id,
                message: `Thread ${payload.id} not found`,
              }),
            );
          }
          return {
            id: row.id,
            title: row.title,
            status: row.status,
            activeBranchId: row.activeBranchId,
            tags: [...(row.tags ?? [])] as string[],
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),

      "branches.listByThread": (payload) =>
        orDie(
          Effect.gen(function* () {
            const rows = yield* database.listBranchesByThread(payload.threadId);
            return rows.map((r) => ({
              id: r.id,
              threadId: r.threadId,
              parentBranchId: r.parentBranchId,
              forkPointMessageId: r.forkPointMessageId,
              name: r.name,
              createdAt: r.createdAt,
            }));
          }),
        ),

      "branches.create": (payload) =>
        orDie(
          Effect.gen(function* () {
            const row = yield* database.createBranch({
              threadId: payload.threadId,
              parentBranchId: payload.parentBranchId,
              forkPointMessageId: payload.forkPointMessageId,
              name: payload.name,
            });
            return {
              id: row.id,
              threadId: row.threadId,
              parentBranchId: row.parentBranchId,
              forkPointMessageId: row.forkPointMessageId,
              name: row.name,
              createdAt: row.createdAt,
            };
          }),
        ),

      "branches.setActive": (payload) =>
        orDie(
          database.setActiveBranch({
            threadId: payload.threadId,
            branchId: payload.branchId,
          }),
        ),

      "messages.listByBranch": (payload) =>
        orDie(
          Effect.gen(function* () {
            const rows = yield* database.listMessagesByBranch({
              threadId: payload.threadId,
              branchId: payload.branchId,
            });
            return rows.map((r) => ({
              id: r.id,
              threadId: r.threadId,
              branchId: r.branchId,
              parentId: r.parentId,
              role: r.role,
              content: r.content,
              metadata: (r.metadata as Record<string, unknown>) ?? {},
              createdAt: r.createdAt,
            }));
          }),
        ),

      "messages.create": (payload) =>
        orDie(
          Effect.gen(function* () {
            const row = yield* database.createMessage({
              threadId: payload.threadId,
              branchId: payload.branchId,
              parentId: payload.parentId,
              role: payload.role,
              content: payload.content,
              metadata: payload.metadata,
            });
            return {
              id: row.id,
              threadId: row.threadId,
              branchId: row.branchId,
              parentId: row.parentId,
              role: row.role,
              content: row.content,
              metadata: (row.metadata as Record<string, unknown>) ?? {},
              createdAt: row.createdAt,
            };
          }),
        ),

      "agent.chat": (payload) =>
        Effect.gen(function* () {
          // Fetch existing messages for context
          const messages = yield* orDie(
            database.listMessagesByBranch({
              threadId: payload.threadId,
              branchId: payload.branchId,
            }),
          );

          const chatMessages = messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }));

          // Add the new user message
          chatMessages.push({ role: "user" as const, content: payload.content });

          // Store the user message
          const userMessage = yield* orDie(
            database.createMessage({
              threadId: payload.threadId,
              branchId: payload.branchId,
              parentId:
                messages.length > 0
                  ? messages[messages.length - 1]!.id
                  : null,
              role: "user",
              content: payload.content,
              metadata: {},
            }),
          );

          // Dispatch to agent
          const responseContent = yield* Effect.mapError(
            agent.chat({
              threadId: payload.threadId,
              branchId: payload.branchId,
              messages: chatMessages,
            }),
            (error) =>
              new AgentError({
                message: String(error),
              }),
          );

          // Store the assistant response
          const assistantMessage = yield* orDie(
            database.createMessage({
              threadId: payload.threadId,
              branchId: payload.branchId,
              parentId: userMessage.id,
              role: "assistant",
              content: responseContent,
              metadata: {},
            }),
          );

          return {
            id: assistantMessage.id,
            threadId: assistantMessage.threadId,
            branchId: assistantMessage.branchId,
            parentId: assistantMessage.parentId,
            role: assistantMessage.role,
            content: assistantMessage.content,
            metadata:
              (assistantMessage.metadata as Record<string, unknown>) ?? {},
            createdAt: assistantMessage.createdAt,
          };
        }),

      "wiki.synthesize": (payload) =>
        Effect.gen(function* () {
          // Get messages from the branch for synthesis
          const messages = yield* orDie(
            database.listMessagesByBranch({
              threadId: payload.threadId,
              branchId: payload.branchId,
            }),
          );

          const content = messages.map((m) => m.content).join("\n\n");
          const slug = payload.title.toLowerCase().replace(/\s+/g, "-");

          const filePath = yield* Effect.mapError(
            wiki.writeArticle({
              title: payload.title,
              slug,
              content,
              tags: [...payload.tags],
              sourceThreadId: payload.threadId,
              sourceBranchIds: [payload.branchId],
              relatedArticles: [],
            }),
            (error) =>
              new WikiError({
                message: String(error),
              }),
          );

          return {
            filePath,
            slug,
            title: payload.title,
          };
        }),

      "wiki.list": () =>
        orDie(
          Effect.gen(function* () {
            const index = yield* wiki.listArticles();
            return index.map((a) => ({
              slug: a.slug,
              title: a.title,
              tags: [...a.tags],
              outboundLinks: [...a.outboundLinks],
            }));
          }),
        ),

      "wiki.orphans": () =>
        orDie(
          Effect.gen(function* () {
            const orphans = yield* wiki.findOrphans();
            return [...orphans];
          }),
        ),
    });
  }),
);

import { Effect, Layer, ServiceMap, Deferred, Option } from "effect";
import { AgentService } from "./agent.js";
import { WikiService } from "./wiki.js";
import type {
  ExplorationStatus,
  ExplorationCheckIn,
  ExplorationDirection,
} from "@gmacko/contracts";

interface ExplorationState {
  id: string;
  threadId: string;
  branchId: string;
  topic: string;
  maxDepth: number;
  status: ExplorationStatus;
  depth: number;
  articlesWritten: string[];
  checkIns: ExplorationCheckInState[];
}

interface ExplorationCheckInState {
  id: string;
  summary: string;
  suggestedDirections: string[];
  articlesWritten: string[];
  depth: number;
  status: ExplorationStatus;
  deferred: Deferred.Deferred<{
    direction: ExplorationDirection;
    redirectTopic: Option.Option<string>;
  }>;
}

function toSummary(state: ExplorationState) {
  const lastCheckIn =
    state.checkIns.length > 0
      ? Option.some(toCheckInSchema(state, state.checkIns[state.checkIns.length - 1]!))
      : Option.none();
  return {
    id: state.id,
    threadId: state.threadId,
    topic: state.topic,
    status: state.status,
    depth: state.depth,
    articlesWrittenCount: state.articlesWritten.length,
    lastCheckIn,
  };
}

function toCheckInSchema(
  state: ExplorationState,
  checkIn: ExplorationCheckInState,
): ExplorationCheckIn {
  return {
    id: checkIn.id,
    explorationId: state.id,
    summary: checkIn.summary,
    suggestedDirections: [...checkIn.suggestedDirections],
    articlesWritten: [...checkIn.articlesWritten],
    depth: checkIn.depth,
    status: checkIn.status,
  };
}

export class ExplorerService extends ServiceMap.Service<
  ExplorerService,
  {
    readonly start: (input: {
      threadId: string;
      branchId: string;
      topic: string;
      maxDepth: number;
    }) => Effect.Effect<ReturnType<typeof toSummary>, Error>;

    readonly respond: (input: {
      explorationId: string;
      checkInId: string;
      direction: ExplorationDirection;
      redirectTopic: Option.Option<string>;
    }) => Effect.Effect<ReturnType<typeof toSummary>, Error>;

    readonly getStatus: (
      explorationId: string,
    ) => Effect.Effect<ReturnType<typeof toSummary>, Error>;

    readonly list: () => Effect.Effect<ReturnType<typeof toSummary>[], Error>;
  }
>()("@gmacko/server/ExplorerService") {}

export const ExplorerServiceLive = Layer.effect(
  ExplorerService,
  Effect.gen(function* () {
    const agent = yield* AgentService;
    const wiki = yield* WikiService;

    const explorations = new Map<string, ExplorationState>();

    function runExplorationLoop(state: ExplorationState) {
      return Effect.gen(function* () {
        let currentTopic = state.topic;

        for (let depth = 1; depth <= state.maxDepth; depth++) {
          state.depth = depth;
          state.status = "running";

          // Ask Claude to research the topic
          const researchResponse = yield* agent.chat({
            threadId: state.threadId,
            branchId: state.branchId,
            messages: [
              {
                role: "user" as const,
                content: `Research this topic in depth: "${currentTopic}". Provide your findings as a well-structured article. At the end, suggest exactly 3 subtopics for further exploration, formatted as a numbered list starting with "SUBTOPICS:" on its own line.`,
              },
            ],
            systemPrompt:
              "You are an autonomous research agent. Write thorough, well-structured wiki articles. Always end with exactly 3 subtopic suggestions.",
          });

          // Parse response to extract article content and subtopics
          const subtopicsMarker = "SUBTOPICS:";
          const markerIdx = researchResponse.indexOf(subtopicsMarker);
          const articleContent =
            markerIdx >= 0
              ? researchResponse.slice(0, markerIdx).trim()
              : researchResponse.trim();
          const subtopicsText =
            markerIdx >= 0
              ? researchResponse.slice(markerIdx + subtopicsMarker.length).trim()
              : "";

          const suggestedDirections = subtopicsText
            .split("\n")
            .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim())
            .filter((line) => line.length > 0)
            .slice(0, 3);

          // Write wiki article
          const slug = currentTopic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const filePath = yield* wiki.writeArticle({
            title: currentTopic,
            slug,
            content: articleContent,
            tags: ["exploration", `depth-${depth}`],
            sourceThreadId: state.threadId,
            sourceBranchIds: [state.branchId],
            relatedArticles: [],
          });

          state.articlesWritten.push(filePath);

          // Create check-in
          const checkInDeferred = yield* Deferred.make<{
            direction: ExplorationDirection;
            redirectTopic: Option.Option<string>;
          }>();

          const checkIn: ExplorationCheckInState = {
            id: crypto.randomUUID(),
            summary: `Explored "${currentTopic}" at depth ${depth}. ${suggestedDirections.length} subtopics identified.`,
            suggestedDirections,
            articlesWritten: [filePath],
            depth,
            status: "awaiting_input",
            deferred: checkInDeferred,
          };

          state.checkIns.push(checkIn);
          state.status = "awaiting_input";

          // If this is the last depth, complete without waiting
          if (depth >= state.maxDepth) {
            state.status = "completed";
            return;
          }

          // Wait for user response
          const response = yield* Deferred.await(checkInDeferred);

          if (response.direction === "stop") {
            state.status = "completed";
            return;
          }

          if (response.direction === "redirect" && Option.isSome(response.redirectTopic)) {
            currentTopic = response.redirectTopic.value;
          } else if (response.direction === "go_deeper" && suggestedDirections.length > 0) {
            // go_deeper picks the first subtopic (user chose to go deeper on current path)
            currentTopic = suggestedDirections[0]!;
          } else if (response.direction === "continue" && suggestedDirections.length > 0) {
            currentTopic = suggestedDirections[0]!;
          }

          state.status = "running";
        }

        state.status = "completed";
      });
    }

    return ExplorerService.of({
      start: (input) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID();
          const state: ExplorationState = {
            id,
            threadId: input.threadId,
            branchId: input.branchId,
            topic: input.topic,
            maxDepth: input.maxDepth,
            status: "running",
            depth: 0,
            articlesWritten: [],
            checkIns: [],
          };

          explorations.set(id, state);

          // Start the exploration loop as a detached background fiber
          yield* runExplorationLoop(state).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                state.status = "completed";
                console.error(`Exploration ${id} failed:`, cause);
              }),
            ),
            Effect.forkDetach,
          );

          return toSummary(state);
        }),

      respond: (input) =>
        Effect.gen(function* () {
          const state = explorations.get(input.explorationId);
          if (!state) {
            return yield* Effect.fail(
              new Error(`Exploration ${input.explorationId} not found`),
            );
          }

          const checkIn = state.checkIns.find((c) => c.id === input.checkInId);
          if (!checkIn) {
            return yield* Effect.fail(
              new Error(`Check-in ${input.checkInId} not found`),
            );
          }

          // Complete the deferred to resume the exploration fiber
          yield* Deferred.succeed(checkIn.deferred, {
            direction: input.direction,
            redirectTopic: input.redirectTopic,
          });

          checkIn.status = "completed" as ExplorationStatus;

          return toSummary(state);
        }),

      getStatus: (explorationId) =>
        Effect.gen(function* () {
          const state = explorations.get(explorationId);
          if (!state) {
            return yield* Effect.fail(
              new Error(`Exploration ${explorationId} not found`),
            );
          }
          return toSummary(state);
        }),

      list: () =>
        Effect.succeed(
          Array.from(explorations.values()).map(toSummary),
        ),
    });
  }),
);

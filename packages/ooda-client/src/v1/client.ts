import type {
  AppendConversationEventInputV1,
  AppendConversationEventResultV1,
  AgentJobListInputV1,
  AgentJobListPageV1,
  AgentJobMutationResultV1,
  AgentJobV1,
  ApprovalDecisionResultV1,
  ApprovalDecisionV1,
  ArchiveConversationInputV1,
  ArchiveConversationResultV1,
  ContextPackV1,
  ConversationDetailV1,
  ConversationEventListInputV1,
  ConversationEventListPageV1,
  ConversationListInputV1,
  ConversationListPageV1,
  CorrectConversationEventInputV1,
  CreateConversationInputV1,
  CreateConversationResultV1,
  CreateHostTurnInputV1,
  CreateHostTurnResultV1,
  CreateAgentJobInputV1,
  CreateAgentJobResultV1,
  CreateProposalInputV1,
  CreateProposalResultV1,
  CreateTtsGrantInputV1,
  CreateTtsGrantResultV1,
  ForkConversationInputV1,
  ForkConversationResultV1,
  IntegrationDeliveryListInputV1,
  IntegrationDeliveryListPageV1,
  MemoryDetailV1,
  AttentionReviewV1,
  CreateOpportunityReviewInputV1,
  CreateOpportunityReviewResultV1,
  MemorySearchInputV1,
  MemorySearchPageV1,
  SubmitMemoryFeedbackInputV1,
  SubmitMemoryFeedbackResultV1,
  DeadLetterV1,
  RepairDeadLetterInputV1,
  RepairDeadLetterResultV1,
  ProblemV1,
  ProposalListInputV1,
  ProposalV1,
} from "@gmacko/ooda/contracts/v1";

type MaybePromise<T> = T | Promise<T>;
type HeaderProvider = () => MaybePromise<Record<string, string>>;
type ClientFetch = typeof globalThis.fetch;

export type ConversationListQueryV1 = Partial<ConversationListInputV1>;
export type ConversationEventListQueryV1 = Omit<
  ConversationEventListInputV1,
  "limit"
> & { limit?: number };

export interface OodaV1ClientOptions {
  baseUrl?: string;
  fetch?: ClientFetch;
  headers?: HeaderProvider;
}

export interface ConversationEventStreamRequestV1 {
  url: string;
  headers: Record<string, string>;
}

export class OodaV1ClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: ProblemV1;

  constructor(problem: ProblemV1) {
    super(problem.detail ?? problem.title);
    this.name = "OodaV1ClientError";
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }
}

function isProblemV1(value: unknown): value is ProblemV1 {
  if (!value || typeof value !== "object") return false;
  const problem = value as Record<string, unknown>;
  return (
    problem.version === "v1" &&
    typeof problem.type === "string" &&
    typeof problem.title === "string" &&
    typeof problem.status === "number" &&
    typeof problem.code === "string" &&
    typeof problem.correlationId === "string"
  );
}

function fallbackProblem(response: Response, body: unknown): ProblemV1 {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : {};
  const data =
    error.data && typeof error.data === "object"
      ? (error.data as Record<string, unknown>)
      : {};
  const message =
    (typeof error.message === "string" && error.message) ||
    (typeof record.message === "string" && record.message) ||
    response.statusText ||
    "OODA request failed";
  const rawCode =
    (typeof data.code === "string" && data.code) ||
    (typeof error.code === "string" && error.code) ||
    "HTTP_REQUEST_FAILED";
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9_]/g, "_");

  return {
    version: "v1",
    type: `https://ooda.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: message,
    status: response.status >= 400 ? response.status : 500,
    code: /^[A-Z]/.test(code) ? code : `HTTP_${code}`,
    detail: message,
    correlationId:
      response.headers.get("x-correlation-id") ?? "client-unknown-correlation",
  };
}

function addQuery(url: URL, values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }
}

export function createOodaV1Client(options: OodaV1ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "https://ooda.blder.bot").replace(
    /\/$/,
    "",
  );
  const fetchFn = options.fetch ?? globalThis.fetch;

  async function resolveHeaders(accept = "application/json") {
    return {
      Accept: accept,
      ...(options.headers ? await options.headers() : {}),
    };
  }

  async function request<T>(
    path: string,
    input?: {
      method?: "GET" | "POST";
      body?: unknown;
      query?: Record<string, unknown>;
    },
  ): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    if (input?.query) addQuery(url, input.query);
    const headers = await resolveHeaders();
    const init: RequestInit = {
      method: input?.method ?? "GET",
      headers:
        input?.body === undefined
          ? headers
          : { ...headers, "Content-Type": "application/json" },
    };
    if (input?.body !== undefined) init.body = JSON.stringify(input.body);

    const response = await fetchFn(url.toString(), init);
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (!response.ok) {
      throw new OodaV1ClientError(
        isProblemV1(body) ? body : fallbackProblem(response, body),
      );
    }
    return body as T;
  }

  return {
    conversations: {
      list(input: ConversationListQueryV1 = {}) {
        return request<ConversationListPageV1>("/api/v1/conversations", {
          query: input,
        });
      },
      create(input: CreateConversationInputV1) {
        return request<CreateConversationResultV1>("/api/v1/conversations", {
          method: "POST",
          body: input,
        });
      },
      retrieve(conversationId: string) {
        return request<ConversationDetailV1>("/api/v1/conversations/retrieve", {
          query: { conversationId },
        });
      },
      fork(input: ForkConversationInputV1) {
        return request<ForkConversationResultV1>("/api/v1/conversations/fork", {
          method: "POST",
          body: input,
        });
      },
      archive(input: ArchiveConversationInputV1) {
        return request<ArchiveConversationResultV1>(
          "/api/v1/conversations/archive",
          {
            method: "POST",
            body: input,
          },
        );
      },
    },
    events: {
      list(input: ConversationEventListQueryV1) {
        return request<ConversationEventListPageV1>("/api/v1/events", {
          query: input,
        });
      },
      append(input: AppendConversationEventInputV1) {
        return request<AppendConversationEventResultV1>("/api/v1/events", {
          method: "POST",
          body: input,
        });
      },
      correct(input: CorrectConversationEventInputV1) {
        return request<AppendConversationEventResultV1>(
          "/api/v1/events/correct",
          {
            method: "POST",
            body: input,
          },
        );
      },
      async streamRequest(input: {
        conversationId: string;
        afterSequence?: string;
      }): Promise<ConversationEventStreamRequestV1> {
        const url = new URL(
          `${baseUrl}/api/v1/conversations/${encodeURIComponent(input.conversationId)}/events/stream`,
        );
        if (input.afterSequence) {
          url.searchParams.set("afterSequence", input.afterSequence);
        }
        return {
          url: url.toString(),
          headers: {
            ...(await resolveHeaders("text/event-stream")),
            ...(input.afterSequence
              ? { "Last-Event-ID": input.afterSequence }
              : {}),
          },
        };
      },
    },
    host: {
      createTurn(input: CreateHostTurnInputV1) {
        return request<CreateHostTurnResultV1>("/api/v1/host-turns", {
          method: "POST",
          body: input,
        });
      },
    },
    context: {
      get(id: string) {
        return request<ContextPackV1>(
          `/api/v1/context-packs/${encodeURIComponent(id)}`,
        );
      },
    },
    memories: {
      search(input: Partial<MemorySearchInputV1> = {}) {
        return request<MemorySearchPageV1>("/api/v1/memories", {
          query: input,
        });
      },
      inspect(memoryId: string) {
        return request<MemoryDetailV1>(
          `/api/v1/memories/${encodeURIComponent(memoryId)}`,
        );
      },
      feedback(input: SubmitMemoryFeedbackInputV1) {
        return request<SubmitMemoryFeedbackResultV1>(
          `/api/v1/memories/edges/${encodeURIComponent(input.edgeId)}/feedback`,
          { method: "POST", body: input },
        );
      },
      createOpportunityReview(input: CreateOpportunityReviewInputV1) {
        return request<CreateOpportunityReviewResultV1>(
          "/api/v1/opportunity-reviews",
          { method: "POST", body: input },
        );
      },
      getOpportunityReview(reviewId: string) {
        return request<AttentionReviewV1>(
          `/api/v1/opportunity-reviews/${encodeURIComponent(reviewId)}`,
        );
      },
    },
    jobs: {
      list(input: Partial<AgentJobListInputV1> & { conversationId: string }) {
        return request<AgentJobListPageV1>("/api/v1/jobs", { query: input });
      },
      get(jobId: string) {
        return request<AgentJobV1>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
      },
      create(input: CreateAgentJobInputV1) {
        return request<CreateAgentJobResultV1>("/api/v1/jobs", {
          method: "POST",
          body: input,
        });
      },
      cancel(input: { jobId: string; idempotencyKey: string }) {
        return request<AgentJobMutationResultV1>(
          `/api/v1/jobs/${encodeURIComponent(input.jobId)}/cancel`,
          { method: "POST", body: input },
        );
      },
    },
    proposals: {
      list(input: Partial<ProposalListInputV1> & { conversationId: string }) {
        return request<{
          items: ProposalV1[];
          pageInfo: { hasMore: boolean; nextCursor?: string };
        }>("/api/v1/proposals", { query: input });
      },
      get(proposalId: string) {
        return request<ProposalV1>(
          `/api/v1/proposals/${encodeURIComponent(proposalId)}`,
        );
      },
      create(input: CreateProposalInputV1) {
        return request<CreateProposalResultV1>("/api/v1/proposals", {
          method: "POST",
          body: input,
        });
      },
      decide(input: ApprovalDecisionV1) {
        return request<ApprovalDecisionResultV1>(
          `/api/v1/proposals/${encodeURIComponent(input.proposalId)}/decisions`,
          { method: "POST", body: input },
        );
      },
    },
    integrations: {
      listDeliveries(
        input: Partial<IntegrationDeliveryListInputV1> & {
          conversationId: string;
        },
      ) {
        return request<IntegrationDeliveryListPageV1>(
          "/api/v1/integrations/deliveries",
          { query: input },
        );
      },
      listDeadLetters(input: {
        conversationId: string;
        cursor?: string;
        limit?: number;
      }) {
        return request<{
          items: DeadLetterV1[];
          pageInfo: { hasMore: boolean; nextCursor?: string };
        }>("/api/v1/integrations/dead-letters", { query: input });
      },
      repairDeadLetter(input: RepairDeadLetterInputV1) {
        return request<RepairDeadLetterResultV1>(
          `/api/v1/integrations/dead-letters/${encodeURIComponent(input.deadLetterId)}/repair`,
          { method: "POST", body: input },
        );
      },
    },
    voice: {
      createGrant(input: CreateTtsGrantInputV1) {
        return request<CreateTtsGrantResultV1>("/api/v1/tts-grants", {
          method: "POST",
          body: input,
        });
      },
      async audioSource(streamUrl: string): Promise<{
        uri: string;
        headers: Record<string, string>;
      }> {
        return {
          uri: streamUrl,
          headers: await resolveHeaders("audio/mpeg"),
        };
      },
    },
  };
}

export type OodaV1Client = ReturnType<typeof createOodaV1Client>;

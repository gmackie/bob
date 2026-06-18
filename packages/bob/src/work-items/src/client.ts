import type {
  CreateArtifactInput,
  CreateArtifactResult,
  CreateCommentInput,
  CreateCommentResult,
  CreateNotificationInput,
  CreateNotificationResult,
  GetWorkItemInput,
  GetWorkItemResult,
  ListActivitiesInput,
  ListActivitiesResult,
  ListChildArtifactGroupsInput,
  ListChildArtifactGroupsResult,
  ListCommentsInput,
  ListCommentsResult,
  ListCurrentArtifactsInput,
  ListCurrentArtifactsResult,
  ListNotificationsInput,
  ListNotificationsResult,
  ListWorkItemsInput,
  ListWorkItemsResult,
  MarkNotificationAsReadInput,
  MarkNotificationAsReadResult,
  PromoteToTaskInput,
  PromoteToTaskResult,
  UpdateWorkItemInput,
  UpdateWorkItemResult,
} from "./schema";

type MaybePromise<T> = T | Promise<T>;

const workItemsRestPaths = {
  list: "/api/v1/work-items/list",
  get: "/api/v1/work-items/get",
  update: "/api/v1/work-items/update",
  promoteToTask: "/api/v1/work-items/promote-to-task",
  listComments: "/api/v1/work-items/list-comments",
  createComment: "/api/v1/work-items/create-comment",
  createArtifact: "/api/v1/work-items/create-artifact",
  listActivities: "/api/v1/work-items/list-activities",
  listCurrentArtifacts: "/api/v1/work-items/list-current-artifacts",
  listChildArtifactGroups: "/api/v1/work-items/list-child-artifact-groups",
  listNotifications: "/api/v1/work-items/list-notifications",
  createNotification: "/api/v1/work-items/create-notification",
  markNotificationAsRead: "/api/v1/work-items/mark-notification-as-read",
} as const satisfies Record<
  keyof WorkItemsOperationInputMap,
  `/api/v1/work-items/${string}`
>;

type WorkItemsOperationName = keyof typeof workItemsRestPaths;

export type WorkItemsRestPath =
  (typeof workItemsRestPaths)[WorkItemsOperationName];

export type {
  CreateArtifactInput,
  CreateArtifactResult,
  CreateCommentInput,
  CreateCommentResult,
  CreateNotificationInput,
  CreateNotificationResult,
  GetWorkItemInput,
  GetWorkItemResult,
  ListActivitiesInput,
  ListActivitiesResult,
  ListChildArtifactGroupsInput,
  ListChildArtifactGroupsResult,
  ListCommentsInput,
  ListCommentsResult,
  ListCurrentArtifactsInput,
  ListCurrentArtifactsResult,
  ListNotificationsInput,
  ListNotificationsResult,
  ListWorkItemsInput,
  ListWorkItemsResult,
  MarkNotificationAsReadInput,
  MarkNotificationAsReadResult,
  PromoteToTaskInput,
  PromoteToTaskResult,
  UpdateWorkItemInput,
  UpdateWorkItemResult,
} from "./schema";

type WorkItemsOperationInputMap = {
  list: ListWorkItemsInput;
  get: GetWorkItemInput;
  update: UpdateWorkItemInput;
  promoteToTask: PromoteToTaskInput;
  listComments: ListCommentsInput;
  createComment: CreateCommentInput;
  createArtifact: CreateArtifactInput;
  listActivities: ListActivitiesInput;
  listCurrentArtifacts: ListCurrentArtifactsInput;
  listChildArtifactGroups: ListChildArtifactGroupsInput;
  listNotifications: ListNotificationsInput;
  createNotification: CreateNotificationInput;
  markNotificationAsRead: MarkNotificationAsReadInput;
};

type WorkItemsOperationOutputMap = {
  list: ListWorkItemsResult;
  get: GetWorkItemResult;
  update: UpdateWorkItemResult;
  promoteToTask: PromoteToTaskResult;
  listComments: ListCommentsResult;
  createComment: CreateCommentResult;
  createArtifact: CreateArtifactResult;
  listActivities: ListActivitiesResult;
  listCurrentArtifacts: ListCurrentArtifactsResult;
  listChildArtifactGroups: ListChildArtifactGroupsResult;
  listNotifications: ListNotificationsResult;
  createNotification: CreateNotificationResult;
  markNotificationAsRead: MarkNotificationAsReadResult;
};

export interface WorkItemsClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  getHeaders?: HeadersInit | (() => MaybePromise<HeadersInit | undefined>);
}

export class WorkItemsClientError<TBody = unknown> extends Error {
  readonly status: number;
  readonly path: WorkItemsRestPath;
  readonly requestId: string | null;
  readonly body: TBody | null;

  constructor(options: {
    message: string;
    status: number;
    path: WorkItemsRestPath;
    requestId: string | null;
    body: TBody | null;
  }) {
    super(options.message);
    this.name = "WorkItemsClientError";
    this.status = options.status;
    this.path = options.path;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

export interface WorkItemsClient {
  list(input: ListWorkItemsInput): Promise<ListWorkItemsResult>;
  get(input: GetWorkItemInput): Promise<GetWorkItemResult>;
  update(input: UpdateWorkItemInput): Promise<UpdateWorkItemResult>;
  promoteToTask(input: PromoteToTaskInput): Promise<PromoteToTaskResult>;
  listComments(input: ListCommentsInput): Promise<ListCommentsResult>;
  createComment(input: CreateCommentInput): Promise<CreateCommentResult>;
  createArtifact(input: CreateArtifactInput): Promise<CreateArtifactResult>;
  listActivities(input: ListActivitiesInput): Promise<ListActivitiesResult>;
  listCurrentArtifacts(
    input: ListCurrentArtifactsInput,
  ): Promise<ListCurrentArtifactsResult>;
  listChildArtifactGroups(
    input: ListChildArtifactGroupsInput,
  ): Promise<ListChildArtifactGroupsResult>;
  listNotifications(
    input: ListNotificationsInput,
  ): Promise<ListNotificationsResult>;
  createNotification(
    input: CreateNotificationInput,
  ): Promise<CreateNotificationResult>;
  markNotificationAsRead(
    input: MarkNotificationAsReadInput,
  ): Promise<MarkNotificationAsReadResult>;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function resolveFetch(fetchFn?: typeof globalThis.fetch) {
  if (fetchFn) {
    return fetchFn;
  }

  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  throw new Error(
    "createWorkItemsClient requires a fetch implementation in this runtime",
  );
}

async function resolveHeaders(
  getHeaders?: WorkItemsClientOptions["getHeaders"],
) {
  if (!getHeaders) {
    return new Headers();
  }

  const headers =
    typeof getHeaders === "function" ? await getHeaders() : getHeaders;

  return new Headers(headers);
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as unknown;
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function getErrorMessage(body: unknown, response: Response) {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }

  if (typeof body === "string" && body.length > 0) {
    return body;
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

function createMethodCaller<TOperation extends WorkItemsOperationName>(
  options: WorkItemsClientOptions,
  operation: TOperation,
) {
  const fetchFn = resolveFetch(options.fetch);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const path = workItemsRestPaths[operation];

  return async function callMethod(
    input: WorkItemsOperationInputMap[TOperation],
  ): Promise<WorkItemsOperationOutputMap[TOperation]> {
    const headers = await resolveHeaders(options.getHeaders);

    if (!headers.has("accept")) {
      headers.set("accept", "application/json");
    }

    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetchFn(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });

    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new WorkItemsClientError({
        message: getErrorMessage(body, response),
        status: response.status,
        path,
        requestId: response.headers.get("x-request-id"),
        body,
      });
    }

    return body as WorkItemsOperationOutputMap[TOperation];
  };
}

export function createWorkItemsClient(
  options: WorkItemsClientOptions,
): WorkItemsClient {
  return {
    list: createMethodCaller(options, "list"),
    get: createMethodCaller(options, "get"),
    update: createMethodCaller(options, "update"),
    promoteToTask: createMethodCaller(options, "promoteToTask"),
    listComments: createMethodCaller(options, "listComments"),
    createComment: createMethodCaller(options, "createComment"),
    createArtifact: createMethodCaller(options, "createArtifact"),
    listActivities: createMethodCaller(options, "listActivities"),
    listCurrentArtifacts: createMethodCaller(options, "listCurrentArtifacts"),
    listChildArtifactGroups: createMethodCaller(
      options,
      "listChildArtifactGroups",
    ),
    listNotifications: createMethodCaller(options, "listNotifications"),
    createNotification: createMethodCaller(options, "createNotification"),
    markNotificationAsRead: createMethodCaller(
      options,
      "markNotificationAsRead",
    ),
  };
}

export { workItemsRestPaths };

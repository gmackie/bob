export interface T3codeReportingEvent {
  id?: string;
  seq: number;
  eventType: string;
  direction: string;
  createdAt?: Date | string | null;
  payload: Record<string, unknown> | string | null;
}

export interface T3codeWorkflowState {
  workflowStatus: string;
  statusMessage: string | null;
}

export interface T3codeTimelineItem {
  id: string;
  seq: number;
  status: string;
  message: string | null;
  threadId: string | null;
  taskRunId: string | null;
  createdAt: string | null;
}

export interface T3codeInteractionReport {
  backendLabel: "t3code server";
  sessionId: string | null;
  taskRunId: string | null;
  status: string;
  message: string | null;
  threadId: string | null;
  linear: {
    identifier: string | null;
    title: string | null;
    url: string | null;
    webBaseUrl: string | null;
  } | null;
  events: T3codeTimelineItem[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function payloadRecord(payload: T3codeReportingEvent["payload"]) {
  if (typeof payload === "string") {
    try {
      return record(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  return record(payload);
}

function isT3RuntimePayload(payload: Record<string, unknown>) {
  return payload.type === "t3_runtime_event";
}

function getExternalTask(payload: Record<string, unknown>) {
  const direct = record(payload.externalTask);
  if (direct) return direct;

  const details = record(payload.details);
  return record(details?.externalTask);
}

function getLinearContext(payloads: Record<string, unknown>[]) {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const externalTask = getExternalTask(payloads[index]!);
    if (!externalTask) continue;

    const hasLinearContext =
      stringValue(externalTask.linearIdentifier) ||
      stringValue(externalTask.linearTitle) ||
      stringValue(externalTask.linearUrl) ||
      stringValue(externalTask.linearWebBaseUrl);

    if (!hasLinearContext) continue;

    return {
      identifier: stringValue(externalTask.linearIdentifier),
      title: stringValue(externalTask.linearTitle),
      url: stringValue(externalTask.linearUrl),
      webBaseUrl: stringValue(externalTask.linearWebBaseUrl),
    };
  }

  return null;
}

function dateString(value: Date | string | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  return stringValue(value);
}

function latestValue<T>(
  items: T[],
  readValue: (item: T) => string | null,
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = readValue(items[index]!);
    if (value) return value;
  }

  return null;
}

export function buildT3codeInteractionReport(input: {
  sessionId: string | null;
  taskRunId: string | null;
  assumeT3code?: boolean;
  workflowState: T3codeWorkflowState | null;
  events: T3codeReportingEvent[];
}): T3codeInteractionReport | null {
  const runtimeEvents = input.events
    .map((event) => {
      const payload = payloadRecord(event.payload);
      return payload && isT3RuntimePayload(payload) ? { event, payload } : null;
    })
    .filter(
      (item): item is { event: T3codeReportingEvent; payload: Record<string, unknown> } =>
        item !== null,
    );

  if (runtimeEvents.length === 0 && !input.assumeT3code) {
    return null;
  }

  if (runtimeEvents.length === 0) {
    return {
      backendLabel: "t3code server",
      sessionId: input.sessionId,
      taskRunId: input.taskRunId,
      status: input.workflowState?.workflowStatus ?? "awaiting_mirror",
      message:
        input.workflowState?.statusMessage ??
        "Bob has an active run, but no t3code runtime events have been mirrored yet.",
      threadId: null,
      linear: null,
      events: [],
    };
  }

  const latest = runtimeEvents[runtimeEvents.length - 1]!;
  const latestPayload = latest.payload;
  const latestStatus =
    stringValue(latestPayload.status) ??
    input.workflowState?.workflowStatus ??
    "working";

  const events = runtimeEvents.map(({ event, payload }) => ({
    id: String(event.seq),
    seq: event.seq,
    status: stringValue(payload.status) ?? "working",
    message: stringValue(payload.message),
    threadId: stringValue(payload.threadId),
    taskRunId: stringValue(payload.taskRunId),
    createdAt: dateString(event.createdAt),
  }));

  return {
    backendLabel: "t3code server",
    sessionId: input.sessionId,
    taskRunId:
      stringValue(latestPayload.taskRunId) ??
      input.taskRunId ??
      latestValue(events, (event) => event.taskRunId),
    status: latestStatus,
    message:
      stringValue(latestPayload.message) ??
      input.workflowState?.statusMessage ??
      null,
    threadId:
      stringValue(latestPayload.threadId) ??
      latestValue(events, (event) => event.threadId),
    linear: getLinearContext(runtimeEvents.map((item) => item.payload)),
    events,
  };
}

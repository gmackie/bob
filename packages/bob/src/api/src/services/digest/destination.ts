export const PINNED_TITLE = "📊 Bob daily digest";
export const REPORT_MARKER = "[bob-digest-report]";
export const DIGEST_DATE = /daily digest — (\d{4}-\d{2}-\d{2})/;
export interface ReportingIssue {
  id: string;
  url: string;
  description: string | null;
}
export interface DigestStore {
  destination(
    scope: string,
    workspaceId: string,
  ): Promise<{ issueId: string | null; phase: string }>;
  claimDestination(this: void, scope: string): Promise<boolean>;
  link(this: void, scope: string, id: string): Promise<string>;
  retryDestination(this: void, scope: string): Promise<void>;
  claimDate(this: void, scope: string, date: string): Promise<boolean>;
  posted(this: void, scope: string, date: string): Promise<void>;
  retryDate(this: void, scope: string, date: string): Promise<void>;
}
export interface DigestTracker {
  find(this: void): Promise<ReportingIssue[]>;
  get(this: void, id: string): Promise<ReportingIssue>;
  create(this: void): Promise<ReportingIssue>;
  retire(
    this: void,
    issue: ReportingIssue,
    canonical: ReportingIssue,
    history: ReportingIssue[],
  ): Promise<void>;
  comments(this: void, id: string): Promise<string[]>;
  post(this: void, id: string, body: string): Promise<void>;
}
export class DigestRejected extends Error {}
export async function publishDigest(
  input: {
    scope: string;
    workspaceId: string;
    date: string;
    render: () => Promise<string>;
  },
  store: DigestStore,
  tracker: DigestTracker,
): Promise<{ posted: boolean; url: string; text?: string }> {
  const destination = await store.destination(input.scope, input.workspaceId);
  // A failed lookup never establishes absence. This also recovers a create
  // whose response was lost and discovers legacy cards without deleting history.
  const history = await tracker.find();
  let pinned = destination.issueId
    ? await tracker.get(destination.issueId)
    : history[0];
  if (!pinned) {
    if (!(await store.claimDestination(input.scope)))
      throw new Error(
        "Digest destination creation is unconfirmed; reconcile tracker history",
      );
    try {
      pinned = await tracker.create();
    } catch (error) {
      if (error instanceof DigestRejected)
        await store.retryDestination(input.scope);
      throw error;
    }
  }
  const canonicalId = await store.link(input.scope, pinned.id);
  if (canonicalId !== pinned.id) pinned = await tracker.get(canonicalId);
  const all = [pinned, ...history.filter((i) => i.id !== pinned.id)];
  for (const issue of all) await tracker.retire(issue, pinned, all);
  for (const issue of all) {
    const comments = await tracker.comments(issue.id);
    if (comments.some((body) => DIGEST_DATE.exec(body)?.[1] === input.date)) {
      await store.posted(input.scope, input.date);
      return { posted: false, url: pinned.url };
    }
  }
  const text = await input.render();
  if (!(await store.claimDate(input.scope, input.date))) {
    throw new Error(
      `Digest ${input.date} is pending or already sent; reconcile tracker comments`,
    );
  }
  try {
    await tracker.post(pinned.id, text);
  } catch (error) {
    if (error instanceof DigestRejected)
      await store.retryDate(input.scope, input.date);
    throw error;
  }
  await store.posted(input.scope, input.date);
  return { posted: true, url: pinned.url, text };
}

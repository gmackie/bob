import type { DigestTracker, ReportingIssue } from "./destination.js";
import { DigestRejected, PINNED_TITLE, REPORT_MARKER } from "./destination.js";

interface Issue extends ReportingIssue {
  title: string;
  team: { id: string };
  state: { type: string };
}
interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}
interface Data {
  issues?: Page<Issue>;
  issue?: Issue & { comments?: Page<{ body: string }> };
  team?: { states: { nodes: { id: string; type: string }[] } };
  issueCreate?: { success: boolean; issue: Issue | null };
  issueUpdate?: { success: boolean };
  commentCreate?: { success: boolean };
}
export function digestTracker(config: {
  apiKey: string;
  apiUrl: string;
  teamId: string;
  retireLocal: (id: string) => Promise<void>;
}): DigestTracker {
  const fields = "id url title description team { id } state { type }";
  async function request(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<Data> {
    const res = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if ([401, 403, 429].includes(res.status))
      throw new DigestRejected(
        `Digest tracker rejected request: ${res.status}`,
      );
    if (!res.ok) throw new Error(`Digest tracker HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Data; errors?: unknown[] };
    if (body.errors?.length || !body.data)
      throw new Error("Digest tracker returned errors or missing data");
    return body.data;
  }
  let canceled: string | undefined;
  async function canceledState(): Promise<string> {
    if (canceled) return canceled;
    const data = await request(
      `query { team(id: ${JSON.stringify(config.teamId)}) { states { nodes { id type } } } }`,
    );
    canceled = data.team?.states.nodes.find((s) => s.type === "canceled")?.id;
    if (!canceled)
      throw new Error(
        "Digest requires a canceled reporting state; no executable card was created",
      );
    return canceled;
  }
  return {
    async find() {
      const issues: Issue[] = [];
      let after: string | null = null;
      do {
        const data: Data = await request(
          `query($after: String) {
          issues(first: 100, after: $after, includeArchived: true, filter: {
            team: { id: { eq: ${JSON.stringify(config.teamId)} } }
          }) { nodes { ${fields} } pageInfo { hasNextPage endCursor } }
        }`,
          { after },
        );
        if (!data.issues)
          throw new Error("Digest lookup missing issue connection");
        issues.push(
          ...data.issues.nodes.filter(
            (i) =>
              i.title === PINNED_TITLE ||
              i.description?.includes(REPORT_MARKER),
          ),
        );
        after = data.issues.pageInfo.hasNextPage
          ? data.issues.pageInfo.endCursor
          : null;
        if (data.issues.pageInfo.hasNextPage && !after)
          throw new Error("Digest lookup missing pagination cursor");
      } while (after);
      // Stable on every worker, even before the destination row is linked.
      return issues.sort((a, b) => a.id.localeCompare(b.id));
    },
    async get(id) {
      const data = await request(
        `query { issue(id: ${JSON.stringify(id)}) { ${fields} } }`,
      );
      if (data.issue?.team.id !== config.teamId)
        throw new Error(
          "Digest destination unavailable or outside configured team",
        );
      return data.issue;
    },
    async create() {
      const stateId = await canceledState();
      const data = await request(
        `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { ${fields} } }
      }`,
        {
          input: {
            title: PINNED_TITLE,
            teamId: config.teamId,
            stateId,
            description: `${REPORT_MARKER}\nReporting history only. Never dispatch this card.`,
          },
        },
      );
      if (!data.issueCreate?.success || !data.issueCreate.issue)
        throw new Error("Digest destination creation unconfirmed");
      return data.issueCreate.issue;
    },
    async retire(issue, canonical, history) {
      const stateId = await canceledState();
      const original =
        (issue.description ?? "").split(REPORT_MARKER)[0]?.trim() ?? "";
      const links =
        issue.id === canonical.id
          ? history.map((i) => `- [Digest history](${i.url})`).join("\n")
          : `[Canonical digest history](${canonical.url})`;
      const description =
        `${original}\n\n${REPORT_MARKER}\nReporting only; never dispatch.\n${links}`.trim();
      const data = await request(
        `mutation($input: IssueUpdateInput!) {
        issueUpdate(id: ${JSON.stringify(issue.id)}, input: $input) { success }
      }`,
        { input: { stateId, description } },
      );
      if (!data.issueUpdate?.success)
        throw new Error("Failed to retire digest reporting card");
      await config.retireLocal(issue.id);
    },
    async comments(id) {
      const bodies: string[] = [];
      let after: string | null = null;
      do {
        const data: Data = await request(
          `query($after: String) { issue(id: ${JSON.stringify(id)}) {
          comments(first: 100, after: $after) { nodes { body } pageInfo { hasNextPage endCursor } }
        } }`,
          { after },
        );
        const page = data.issue?.comments;
        if (!page) throw new Error("Digest comment lookup failed");
        bodies.push(...page.nodes.map((c) => c.body));
        after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        if (page.pageInfo.hasNextPage && !after)
          throw new Error("Digest comments missing pagination cursor");
      } while (after);
      return bodies;
    },
    async post(id, body) {
      const data = await request(
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId: id, body } },
      );
      if (!data.commentCreate?.success)
        throw new Error("Digest comment delivery unconfirmed");
    },
  };
}

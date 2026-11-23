import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@bob/db/client";

import type { GitProviderClient, GitPullRequest } from "../../services/git/providers/types";
import {
  forgejoRemote,
  parseDbTimestamp,
  prTitle,
  reconcileTrackerPullRequests,
} from "../reconcileTrackerPullRequests";

const INSTANCE = "https://git.forgegraf.com";
const NOW = new Date("2026-10-06T12:00:00Z");

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    runId: "11111111-aaaa-4bbb-8ccc-000000000001",
    userId: "user-1",
    sessionId: "session-1",
    branch: "bob/GMA-612-fix-the-login-redirect",
    createdAt: "2026-10-06 10:00:00.123456",
    identifierSnapshot: "GMA-612",
    workItemId: "wi-1",
    title: "Fix the login redirect",
    description: "Users land on /404 after login.",
    externalProvider: "linear",
    externalId: "cb43f3bb-295f-42ca-9a95-a8ba4076e084",
    externalUrl: "https://tasks.gmac.io/gmacko/issue/GMA-612",
    sourceMetadata: {},
    repositoryId: "repo-1",
    remoteUrl: "git@git.forgegraf.com:gmackie/driftport.git",
    remoteOwner: null,
    remoteName: null,
    remoteInstanceUrl: null,
    mainBranch: "master",
    ...overrides,
  };
}

function remotePr(overrides: Partial<GitPullRequest> = {}): GitPullRequest {
  return {
    id: 1,
    number: 15,
    title: "GMA-612: Fix the login redirect",
    body: "body",
    state: "open",
    draft: false,
    headBranch: "bob/GMA-612-fix-the-login-redirect",
    baseBranch: "master",
    headSha: "abc123",
    url: `${INSTANCE}/gmackie/driftport/pulls/15`,
    createdAt: NOW,
    updatedAt: NOW,
    mergedAt: null,
    closedAt: null,
    ...overrides,
  };
}

/** Drizzle-shaped fake: the candidate query, PR lookup/insert, and recorded writes. */
function fakeDb(rows: Record<string, unknown>[], opts: { existingPr?: Record<string, unknown> } = {}) {
  const meta: Record<string, Record<string, unknown>> = {};
  for (const r of rows) meta[r.workItemId as string] = { ...(r.sourceMetadata as Record<string, unknown>) };
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  const db = {
    select: () => chain,
    query: {
      pullRequests: { findFirst: vi.fn(() => Promise.resolve(opts.existingPr ?? null)) },
      workItems: {
        findFirst: vi.fn(() => Promise.resolve({ sourceMetadata: meta["wi-1"] ?? {} })),
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return { returning: () => Promise.resolve([{ id: "pr-row-1", ...values }]) };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        if (values.sourceMetadata) meta["wi-1"] = values.sourceMetadata as Record<string, unknown>;
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db: db as unknown as Db, inserts, updates, meta };
}

function fakeClient(overrides: Partial<GitProviderClient> = {}) {
  return {
    provider: "gitea",
    findPullRequestByHead: vi.fn(() => Promise.resolve(null)),
    listCommits: vi.fn(() =>
      Promise.resolve([
        {
          sha: "abc123",
          message: "fix: redirect\n\nRefs: GMA-612",
          authorName: "Bob",
          authorEmail: "bob@x",
          committedAt: new Date("2026-10-06T10:20:00Z"),
          url: "",
        },
      ]),
    ),
    createPullRequest: vi.fn(() => Promise.resolve(remotePr())),
    ...overrides,
  } as unknown as GitProviderClient & {
    findPullRequestByHead: ReturnType<typeof vi.fn>;
    listCommits: ReturnType<typeof vi.fn>;
    createPullRequest: ReturnType<typeof vi.fn>;
  };
}

function run(db: Db, client: GitProviderClient, announce = vi.fn(() => Promise.resolve())) {
  return reconcileTrackerPullRequests(db, {
    forgejoToken: "tok",
    forgejoInstanceUrl: INSTANCE,
    clientFor: () => client,
    announce,
    now: () => NOW,
  });
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("reconcileTrackerPullRequests", () => {
  it("opens the PR the runner could not (SSH remote), titled GMA-612:, records it and reports ready once", async () => {
    const { db, inserts, updates, meta } = fakeDb([candidate()]);
    const client = fakeClient();
    const announce = vi.fn(() => Promise.resolve());

    const r = await run(db, client, announce);

    expect(client.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "gmackie",
        repo: "driftport",
        head: "bob/GMA-612-fix-the-login-redirect",
        base: "master",
        title: "GMA-612: Fix the login redirect",
      }),
    );
    const body = (client.createPullRequest.mock.calls[0]?.[0] as { body: string }).body;
    expect(body).toContain("Refs: GMA-612");
    expect(inserts[0]).toMatchObject({
      provider: "gitea",
      instanceUrl: INSTANCE,
      remoteOwner: "gmackie",
      remoteName: "driftport",
      number: 15,
      status: "open",
      sessionId: "session-1",
      planningTaskId: "GMA-612",
    });
    expect(updates).toContainEqual({ pullRequestId: "pr-row-1" });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pr-row-1", url: `${INSTANCE}/gmackie/driftport/pulls/15` }),
      { title: "GMA-612: Fix the login redirect", body: "body", headSha: "abc123" },
    );
    expect(r).toMatchObject({ scanned: 1, opened: 1, recorded: 0, announced: 1 });
    expect(meta["wi-1"]?.trackerPrChecks).toEqual({ [candidate().runId]: "opened" });
  });

  it("records the PR the runner opened but the gateway dropped, without opening another", async () => {
    const { db, inserts } = fakeDb([candidate()]);
    const client = fakeClient({ findPullRequestByHead: vi.fn(() => Promise.resolve(remotePr({ number: 14 }))) });
    const announce = vi.fn(() => Promise.resolve());

    const r = await run(db, client, announce);

    expect(client.createPullRequest).not.toHaveBeenCalled();
    expect(inserts[0]).toMatchObject({ number: 14 });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ recorded: 1, opened: 0 });
  });

  it("links an already-recorded PR row instead of inserting a duplicate", async () => {
    const existing = { id: "pr-existing", status: "open", url: `${INSTANCE}/gmackie/driftport/pulls/15` };
    const { db, inserts, updates } = fakeDb([candidate()], { existingPr: existing });
    const client = fakeClient({ findPullRequestByHead: vi.fn(() => Promise.resolve(remotePr())) });

    await run(db, client);

    expect(inserts).toHaveLength(0);
    expect(updates).toContainEqual({ pullRequestId: "pr-existing" });
  });

  it("does not report when the run pushed nothing (no branch on the remote)", async () => {
    const { db, inserts, meta } = fakeDb([candidate()]);
    const client = fakeClient({
      listCommits: vi.fn(() => Promise.reject(new Error('Gitea API error (404): {"message":"not found"}'))),
    });
    const announce = vi.fn(() => Promise.resolve());

    const r = await run(db, client, announce);

    expect(client.createPullRequest).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(announce).not.toHaveBeenCalled();
    expect(r.items[0]?.outcome).toBe("no_branch");
    expect(meta["wi-1"]?.trackerPrChecks).toEqual({ [candidate().runId]: "no_branch" });
  });

  it("does not open a PR for an older attempt's branch this run did not push to", async () => {
    const { db } = fakeDb([candidate()]);
    const client = fakeClient({
      listCommits: vi.fn(() =>
        Promise.resolve([
          {
            sha: "old0000",
            message: "x",
            authorName: "",
            authorEmail: "",
            committedAt: new Date("2026-10-05T08:00:00Z"),
            url: "",
          },
        ]),
      ),
    });

    const r = await run(db, client);

    expect(client.createPullRequest).not.toHaveBeenCalled();
    expect(r.items[0]?.outcome).toBe("stale_branch");
  });

  it("skips runs it already settled, so a report is never repeated by this sweep", async () => {
    const settled = candidate({ sourceMetadata: { trackerPrChecks: { [candidate().runId]: "opened" } } });
    const { db } = fakeDb([settled]);
    const client = fakeClient();

    const r = await run(db, client);

    expect(r.scanned).toBe(0);
    expect(client.findPullRequestByHead).not.toHaveBeenCalled();
  });

  it("retries a transient git-host error next tick instead of settling it", async () => {
    const { db, meta } = fakeDb([candidate()]);
    const client = fakeClient({
      findPullRequestByHead: vi.fn(() => Promise.reject(new Error("Gitea API error (502): bad gateway"))),
    });

    const r = await run(db, client);

    expect(r.items[0]?.outcome).toBe("error");
    expect(meta["wi-1"]?.trackerPrChecks).toBeUndefined();
  });

  it("leaves repos on other hosts alone (only the Forgejo token is held)", async () => {
    const { db } = fakeDb([candidate({ remoteUrl: "git@github.com:gmackie/pulse.git" })]);
    const client = fakeClient();

    const r = await run(db, client);

    expect(client.findPullRequestByHead).not.toHaveBeenCalled();
    expect(r.items[0]?.outcome).toBe("unsupported");
  });

  it("finds the PR when a parallel opener wins the race (409)", async () => {
    const { db, inserts } = fakeDb([candidate()]);
    const find = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(remotePr({ number: 16 }));
    const client = fakeClient({
      findPullRequestByHead: find,
      createPullRequest: vi.fn(() => Promise.reject(new Error("Gitea API error (409): pull request already exists"))),
    });

    await run(db, client);

    expect(inserts[0]).toMatchObject({ number: 16 });
  });

  it("does nothing without a Forgejo token", async () => {
    const { db } = fakeDb([candidate()]);
    const r = await reconcileTrackerPullRequests(db, {});
    expect(r).toMatchObject({ scanned: 0, items: [] });
  });
});

describe("helpers", () => {
  it("prTitle prefixes the identifier once and falls back to [Bob] for untracked items", () => {
    expect(prTitle("GMA-612", "Fix it")).toBe("GMA-612: Fix it");
    expect(prTitle("GMA-612", "GMA-612: Fix it")).toBe("GMA-612: Fix it");
    expect(prTitle(null, "Fix it")).toBe("[Bob] Fix it");
  });

  it("forgejoRemote reads SSH and token-HTTPS remotes without exposing credentials", () => {
    const base = { remoteOwner: null, remoteName: null, remoteInstanceUrl: null };
    expect(forgejoRemote({ ...base, remoteUrl: "git@git.forgegraf.com:gmackie/bob.git" }, INSTANCE)).toEqual({
      owner: "gmackie",
      name: "bob",
    });
    expect(
      forgejoRemote({ ...base, remoteUrl: "https://gmackie:secret@git.forgegraf.com/gmackie/driftport.git" }, INSTANCE),
    ).toEqual({ owner: "gmackie", name: "driftport" });
    expect(forgejoRemote({ ...base, remoteUrl: "git@github.com:gmackie/pulse.git" }, INSTANCE)).toBeNull();
  });

  it("parseDbTimestamp treats a zone-less DB timestamp as UTC", () => {
    expect(parseDbTimestamp("2026-10-06 00:19:08.322215")).toBe(Date.parse("2026-10-06T00:19:08.322Z"));
    expect(parseDbTimestamp("2026-10-06T00:19:08+00:00")).toBe(Date.parse("2026-10-06T00:19:08Z"));
  });
});

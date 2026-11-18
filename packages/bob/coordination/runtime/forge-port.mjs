import { readFileSync } from 'node:fs';
import { fail } from './coordinator.mjs';

/** BOB-82: the release driver's view of Forgejo (git.forgegraf.com) and ForgeGraph.
 * Fetch only, no SDKs. Every request has a timeout and refuses redirects, so a token
 * never follows a 3xx to another origin. Errors carry an HTTP status, never a body
 * or a header, so logs cannot leak credentials. */

export function loadReleaseConfig(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const text = value => typeof value === 'string' && value.length > 0;
  if (!text(config?.forgejo?.instanceUrl) || !text(config?.forgejo?.token)) fail('InvalidRequest', 'Release config needs forgejo.instanceUrl and forgejo.token', 400);
  if (config.forgegraph && (!text(config.forgegraph.baseUrl) || !text(config.forgegraph.token))) fail('InvalidRequest', 'Release config forgegraph needs baseUrl and token', 400);
  for (const url of [config.forgejo.instanceUrl, config.forgegraph?.baseUrl].filter(Boolean)) {
    if (new URL(url).protocol !== 'https:' && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) fail('InvalidRequest', 'Release endpoints must use https', 400);
  }
  return config;
}

class ForgeError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export function forgePort({ forgejo, forgegraph, fetch: transport = fetch, timeoutMs = 15_000 }) {
  const call = async (base, auth, method, path, body) => {
    const response = await transport(`${base.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { authorization: auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    return response;
  };
  const json = async (response, what) => {
    if (!response.ok) throw new ForgeError(response.status === 404 ? 'NotFound' : 'ForgeUnavailable', `${what}: HTTP ${response.status}`, response.status);
    return response.json();
  };
  const repoPath = slug => {
    const [owner, name] = slug.split('/');
    return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  };
  const git = (method, path, body, token = forgejo.token) => call(forgejo.instanceUrl, `token ${token}`, method, path, body);
  const fg = (method, path) => {
    if (!forgegraph) throw new ForgeError('ForgeUnavailable', 'ForgeGraph is not configured');
    return call(forgegraph.baseUrl, `Bearer ${forgegraph.token}`, method, path);
  };
  const prOf = pr => ({ number: pr.number, url: typeof pr.html_url === 'string' && pr.html_url.startsWith('https://') ? pr.html_url : undefined });

  return {
    async branchHead(repo, branch) {
      const response = await git('GET', `${repoPath(repo)}/branches/${encodeURIComponent(branch)}`);
      if (response.status === 404) return null;
      const body = await json(response, 'branch');
      return /^[a-f0-9]{40}$/.test(body?.commit?.id ?? '') ? body.commit.id : null;
    },
    async defaultBranch(repo) {
      const body = await json(await git('GET', repoPath(repo)), 'repository');
      if (typeof body?.default_branch !== 'string') throw new ForgeError('ForgeUnavailable', 'repository: no default branch');
      return body.default_branch;
    },
    /** The open PR from this repository's `branch` into `base`; fork PRs never match. */
    async findPullRequest(repo, branch, base) {
      for (let page = 1; page <= 5; page++) {
        const list = await json(await git('GET', `${repoPath(repo)}/pulls?state=open&limit=50&page=${page}`), 'pulls');
        const hit = list.find(pr => pr?.head?.ref === branch && (!base || pr?.base?.ref === base) && (pr?.head?.repo?.full_name ?? repo).toLowerCase() === repo.toLowerCase());
        if (hit) return prOf(hit);
        if (list.length < 50) return null;
      }
      return null;
    },
    async openPullRequest(repo, { head, base, title, body }) {
      const response = await git('POST', `${repoPath(repo)}/pulls`, { head, base, title: title.slice(0, 240), body });
      // 409/422: a PR for this head already exists (opened concurrently); look it up.
      if (response.status === 409 || response.status === 422) {
        const existing = await this.findPullRequest(repo, head, base);
        if (existing) return existing;
      }
      return prOf(await json(response, 'open pull request'));
    },
    async pullRequest(repo, number) {
      const pr = await json(await git('GET', `${repoPath(repo)}/pulls/${number}`), 'pull request');
      return { state: pr.state, merged: pr.merged === true, mergeSha: pr.merge_commit_sha ?? null, headSha: pr?.head?.sha ?? null, headRepo: pr?.head?.repo?.full_name ?? null, mergeable: pr.mergeable !== false };
    },
    /** BOB-88: closes the PR, then comments why. The caller checks it is open and not
     * merged first; this never merges or reopens anything. A failed close throws. The
     * comment is best-effort: Forgejo needs write:issue for it, which a release token
     * scoped to write:repository lacks (HTTP 403), and a missing comment must not leave a
     * superseded PR open. Returns { comment: 'posted' | 'skipped (<reason>)' }. */
    async closePullRequest(repo, number, comment) {
      await json(await git('PATCH', `${repoPath(repo)}/pulls/${number}`, { state: 'closed' }), 'close pull request');
      try {
        const response = await git('POST', `${repoPath(repo)}/issues/${number}/comments`, { body: comment });
        return { comment: response.ok ? 'posted' : `skipped (HTTP ${response.status})` };
      } catch (error) {
        return { comment: `skipped (${error?.name === 'TimeoutError' ? 'timeout' : 'network error'})` };
      }
    },
    async combinedStatus(repo, sha) {
      const body = await json(await git('GET', `${repoPath(repo)}/commits/${sha}/status`), 'commit status');
      const total = Number(body?.total_count ?? (Array.isArray(body?.statuses) ? body.statuses.length : 0));
      return { state: total > 0 ? String(body?.state ?? 'pending') : 'none', total };
    },
    async approve(repo, number, sha) {
      const response = await git('POST', `${repoPath(repo)}/pulls/${number}/reviews`, { event: 'APPROVED', commit_id: sha, body: 'Approved by Bob coordination: CI is green on this exact head.' }, forgejo.reviewToken ?? forgejo.token);
      // Forgejo refuses approving your own PR (422); the merge can still go ahead
      // where branch protection does not require an approval.
      if (response.status === 422 || response.status === 403) return { approved: false, reason: `approval refused (HTTP ${response.status})` };
      await json(response, 'approve');
      return { approved: true };
    },
    async merge(repo, number, sha) {
      const response = await git('POST', `${repoPath(repo)}/pulls/${number}/merge`, { Do: 'merge', head_commit_id: sha, delete_branch_after_merge: true });
      if (response.status === 405 || response.status === 409 || response.status === 422) {
        // 405 is also "already merged": someone merged it between our read and this call.
        const pr = await this.pullRequest(repo, number);
        if (pr.merged && /^[a-f0-9]{40}$/.test(pr.mergeSha ?? '')) return { merged: true, mergeSha: pr.mergeSha };
        return { merged: false, reason: `Forgejo refused the merge (HTTP ${response.status})` };
      }
      if (!response.ok) await json(response, 'merge');
      const pr = await this.pullRequest(repo, number);
      if (!pr.merged || !/^[a-f0-9]{40}$/.test(pr.mergeSha ?? '')) return { merged: false, reason: 'the pull request is not merged after the merge call' };
      return { merged: true, mergeSha: pr.mergeSha };
    },
    async forgegraphApp(repo) {
      const response = await git('GET', `${repoPath(repo)}/contents/.forgegraph.yaml`);
      if (response.status === 404) return null;
      const file = await json(response, '.forgegraph.yaml');
      if (!file?.content) return null;
      const yaml = Buffer.from(String(file.content).replace(/\n/g, ''), 'base64').toString('utf8');
      return /^app:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/m.exec(yaml)?.[1] ?? null; // top-level key only
    },
    /** True when `sha` is among the 200 most recent ancestors of `head` (inclusive). */
    async containsCommit(repo, head, sha) {
      for (let page = 1; page <= 4; page++) {
        const list = await json(await git('GET', `${repoPath(repo)}/commits?sha=${head}&limit=50&page=${page}&stat=false&verification=false&files=false`), 'commits');
        if (list.some(commit => commit?.sha === sha)) return true;
        if (list.length < 50) return false;
      }
      return false;
    },
    async deployments(app, stage) {
      const body = await json(await fg('GET', `/api/fg/deploy?appSlug=${encodeURIComponent(app)}&stage=${encodeURIComponent(stage)}`), 'deployments');
      return (Array.isArray(body?.deployments) ? body.deployments : []).map(d => ({ id: String(d.id), status: d.status, historyStatus: d.historyStatus ?? null, commitSha: d.commitSha ?? null, createdAt: d.createdAt, storePath: d.storePath ?? null, versionId: d.versionId ?? null }));
    },
    async health(app, stage) {
      const body = await json(await fg('GET', `/api/fg/apps/${encodeURIComponent(app)}/health`), 'health');
      const status = body?.health?.[stage]?.status;
      return ['healthy', 'degraded', 'critical', 'unknown'].includes(status) ? status : 'unknown';
    },
    async rollback(deploymentId) {
      await json(await fg('POST', `/api/fg/deploy/${encodeURIComponent(deploymentId)}/rollback`), 'rollback');
    },
  };
}

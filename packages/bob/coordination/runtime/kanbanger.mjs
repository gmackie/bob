import { readFileSync } from 'node:fs';
import { CoordinationError } from './coordinator.mjs';

/** Kanbanger's Linear-compatible GraphQL API. Reads accept an identifier such as
 * BOB-37; mutations require the issue UUID. The API key is sent the way Bob's
 * LinearClient sends it (`Authorization: <key>`) and never enters logs, errors,
 * coordination payloads or the database. */
export const defaultKanbangerEndpoint = 'https://tasks.gmac.io/graphql';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issueFields = 'id identifier title url state { id name type } team { id key name } project { id name }';

export class KanbangerError extends CoordinationError {
  constructor(code, message, { status = 502, retryable = false } = {}) { super(code, message, status); this.retryable = retryable; }
}
const clip = value => String(value ?? '').replace(/\s+/g, ' ').slice(0, 300);

/** Loads an operator-owned kanbanger.json. `token` or `tokenEnv` (an environment
 * variable name) supplies the API key. */
export function loadKanbangerConfig(path, env = process.env) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new KanbangerError('InvalidRequest', 'Kanbanger config must be an object', { status: 400 });
  const token = config.token ?? (typeof config.tokenEnv === 'string' ? env[config.tokenEnv] : undefined);
  return { ...config, token };
}

export function kanbangerClient({ endpoint = defaultKanbangerEndpoint, token, integrationId, timeoutMs = 10000, fetch: transport = fetch } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new KanbangerError('InvalidRequest', 'Invalid Kanbanger endpoint', { status: 400 }); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw new KanbangerError('InvalidRequest', 'Kanbanger endpoint must be https (http only for loopback) without credentials', { status: 400 });
  if (typeof token !== 'string' || token.length < 8 || /\s/.test(token)) throw new KanbangerError('InvalidRequest', 'A Kanbanger API token is required', { status: 400 });
  if (typeof integrationId !== 'string' || !integrationId) throw new KanbangerError('InvalidRequest', 'Kanbanger integrationId is required', { status: 400 });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new KanbangerError('InvalidRequest', 'Invalid Kanbanger timeout', { status: 400 });
  const stateCache = new Map();

  async function request(query, variables) {
    let response;
    try {
      response = await transport(url.toString(), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: token }, body: JSON.stringify({ query, variables }) });
    } catch (error) {
      throw new KanbangerError('KanbangerUnavailable', `Kanbanger request failed: ${clip(error?.name === 'TimeoutError' ? 'timeout' : error?.message)}`, { status: 503, retryable: true });
    }
    let body = null;
    try { body = await response.json(); } catch { /* reported below */ }
    if (response.status === 401 || response.status === 403) throw new KanbangerError('KanbangerUnauthorized', `Kanbanger refused the credential (HTTP ${response.status})`, { status: 502 });
    if (response.status === 429 || response.status >= 500) throw new KanbangerError('KanbangerUnavailable', `Kanbanger is unavailable (HTTP ${response.status})`, { status: 503, retryable: true });
    if (!response.ok || !body || typeof body !== 'object') throw new KanbangerError('KanbangerRejected', `Kanbanger rejected the request (HTTP ${response.status})`);
    if (Array.isArray(body.errors) && body.errors.length) {
      const message = clip(body.errors.map(error => error?.message).join('; '));
      const notFound = body.errors.some(error => /not.?found|entity not found/i.test(error?.message ?? '') || error?.extensions?.code === 'NOT_FOUND');
      throw new KanbangerError(notFound ? 'IssueNotFound' : 'KanbangerRejected', `Kanbanger GraphQL error: ${message}`, { status: notFound ? 404 : 502 });
    }
    if (!body.data || typeof body.data !== 'object') throw new KanbangerError('KanbangerRejected', 'Kanbanger returned no data');
    return body.data;
  }
  const snapshot = issue => {
    if (!issue || typeof issue.id !== 'string' || !uuid.test(issue.id) || typeof issue.identifier !== 'string' || !issue.team?.id) throw new KanbangerError('KanbangerRejected', 'Kanbanger returned an unexpected issue shape');
    return { id: issue.id, identifier: issue.identifier, title: issue.title ?? null, url: issue.url ?? null,
      state: issue.state ? { id: issue.state.id, name: issue.state.name, type: issue.state.type } : null,
      team: { id: issue.team.id, key: issue.team.key ?? null, name: issue.team.name ?? null },
      project: issue.project ? { id: issue.project.id, name: issue.project.name ?? null } : null };
  };
  const requireUuid = id => { if (typeof id !== 'string' || !uuid.test(id)) throw new KanbangerError('InvalidRequest', 'Kanbanger mutations require an issue UUID', { status: 400 }); };

  const client = {
    integrationId,
    /** Identifier (BOB-37) or UUID → issue snapshot. */
    async resolveIssue(reference) {
      if (typeof reference !== 'string' || !reference || reference.length > 128) throw new KanbangerError('InvalidRequest', 'Invalid issue reference', { status: 400 });
      const data = await request(`query BobCoordinationIssue($id: String!) { issue(id: $id) { ${issueFields} } }`, { id: reference });
      if (!data.issue) throw new KanbangerError('IssueNotFound', 'Kanbanger issue not found', { status: 404 });
      return snapshot(data.issue);
    },
    /** Team workflow states, cached per client. IDs are always discovered. */
    async workflowStates(teamId) {
      if (stateCache.has(teamId)) return stateCache.get(teamId);
      const data = await request('query BobCoordinationStates($teamId: ID!) { workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 100) { nodes { id name type position } } }', { teamId });
      const states = data.workflowStates?.nodes;
      if (!Array.isArray(states) || !states.every(state => typeof state?.id === 'string' && typeof state.name === 'string')) throw new KanbangerError('KanbangerRejected', 'Kanbanger returned unexpected workflow states');
      const value = states.map(({ id, name, type, position }) => ({ id, name, type: type ?? null, position: position ?? null }));
      stateCache.set(teamId, value);
      return value;
    },
    /** Moves an issue by UUID, then reads it back and verifies the state. */
    async updateIssueState(issueId, stateId) {
      requireUuid(issueId);
      const data = await request('mutation BobCoordinationState($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }', { id: issueId, stateId });
      if (data.issueUpdate?.success !== true) throw new KanbangerError('KanbangerRejected', 'Kanbanger did not apply the state update', { retryable: true });
      const after = await client.resolveIssue(issueId);
      if (after.state?.id !== stateId) throw new KanbangerError('KanbangerReadBackMismatch', 'Issue state differs from the requested state after update', { retryable: true });
      return after;
    },
    /** Comment text always travels as a GraphQL variable. */
    async createComment(issueId, body) {
      requireUuid(issueId);
      if (typeof body !== 'string' || !body.length || body.length > 60000) throw new KanbangerError('InvalidRequest', 'Invalid comment body', { status: 400 });
      const data = await request('mutation BobCoordinationComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } } }', { issueId, body });
      if (data.commentCreate?.success !== true || typeof data.commentCreate.comment?.id !== 'string') throw new KanbangerError('KanbangerRejected', 'Kanbanger did not create the comment', { retryable: true });
      return { id: data.commentCreate.comment.id };
    },
    async issueComments(issueId) {
      requireUuid(issueId);
      const data = await request('query BobCoordinationComments($id: String!) { issue(id: $id) { id comments(first: 100) { nodes { id body } } } }', { id: issueId });
      if (!data.issue) throw new KanbangerError('IssueNotFound', 'Kanbanger issue not found', { status: 404 });
      const nodes = data.issue.comments?.nodes;
      if (!Array.isArray(nodes)) throw new KanbangerError('KanbangerRejected', 'Kanbanger returned unexpected comments');
      return nodes.map(node => ({ id: node.id, body: typeof node.body === 'string' ? node.body : '' }));
    },
  };
  return client;
}

const sameTeam = (snapshot, teamId) => snapshot.team.id === teamId || (snapshot.team.key != null && snapshot.team.key === teamId);
const sameProject = (snapshot, projectId) => snapshot.project != null && snapshot.project.id === projectId;

/** Admission resolver: the issue must resolve in Kanbanger and its team/project
 * must equal both the plan's IssueRef and a configured policy issueProject. */
export function kanbangerIssueResolver(client) {
  return async (issue, policy) => {
    if (issue.integrationId !== client.integrationId) throw new KanbangerError('IssueUnresolvable', 'Issue integration has no configured resolver', { status: 403 });
    let snapshot;
    try { snapshot = await client.resolveIssue(issue.identifier ?? issue.issueId); }
    catch (error) {
      if (error.code === 'IssueNotFound') throw new KanbangerError('IssueNotFound', 'Issue does not resolve in Kanbanger', { status: 404 });
      throw new KanbangerError('IssueResolutionUnavailable', `Issue resolution failed: ${error.message}`, { status: error.retryable ? 503 : 502, retryable: Boolean(error.retryable) });
    }
    if (![snapshot.id, snapshot.identifier].includes(issue.issueId) || (issue.identifier != null && issue.identifier !== snapshot.identifier)) throw new KanbangerError('IssueMismatch', 'Resolved issue identity differs from the plan issue', { status: 409 });
    const allowed = policy.issueProjects.some(project => project.integrationId === issue.integrationId && project.workspaceId === issue.workspaceId && project.teamId === issue.teamId && project.projectId === issue.projectId);
    if (!allowed || !sameTeam(snapshot, issue.teamId) || !sameProject(snapshot, issue.projectId)) throw new KanbangerError('IssueProjectMismatch', 'Resolved issue team/project is outside the trusted policy', { status: 403 });
    return snapshot;
  };
}
export { sameTeam, sameProject };

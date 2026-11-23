import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

/** In-memory Linear-compatible GraphQL fake. Reads accept identifiers or UUIDs;
 * mutations accept only UUIDs, like the deployed Kanbanger API. */
export const teamId = '11111111-1111-4111-8111-111111111111';
export const projectId = '22222222-2222-4222-8222-222222222222';
export const otherProjectId = '33333333-3333-4333-8333-333333333333';
export const issueUuid = '44444444-4444-4444-8444-444444444444';
export const states = [
  { id: '55555555-0000-4000-8000-000000000001', name: 'Todo', type: 'unstarted', position: 1 },
  { id: '55555555-0000-4000-8000-000000000002', name: 'In Progress', type: 'started', position: 2 },
  { id: '55555555-0000-4000-8000-000000000003', name: 'In Review', type: 'started', position: 3 },
  { id: '55555555-0000-4000-8000-000000000004', name: 'Done', type: 'completed', position: 4 },
];

export async function fakeKanbanger({ token = 'kanbanger-test-token' } = {}) {
  const issues = new Map([[issueUuid, { id: issueUuid, identifier: 'BOB-37', title: 'Coordinate', url: 'https://tasks.example/BOB-37', stateId: states[0].id, projectId, comments: [] }],
    ['66666666-6666-4666-8666-666666666666', { id: '66666666-6666-4666-8666-666666666666', identifier: 'BOB-99', title: 'Elsewhere', url: null, stateId: states[0].id, projectId: otherProjectId, comments: [] }]]);
  const calls = [];
  const fake = { issues, calls, token, failNext: [], status: null };
  const find = id => [...issues.values()].find(issue => issue.id === id || issue.identifier === id);
  const view = issue => ({ id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url, state: states.find(state => state.id === issue.stateId),
    team: { id: teamId, key: 'BOB', name: 'Bob' }, project: { id: issue.projectId, name: 'Project' } });
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw), operation = /(?:query|mutation) (\w+)/.exec(body.query)?.[1];
    calls.push({ operation, headers: request.headers, body });
    const send = (status, payload) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(payload)); };
    const injected = fake.failNext.shift();
    if (injected) return injected(request, response, send);
    if (request.headers.authorization !== token) return send(401, { errors: [{ message: 'Unauthorized' }] });
    const v = body.variables;
    const uuidOnly = id => /^[0-9a-f-]{36}$/.test(id) ? issues.get(id) : undefined;
    switch (operation) {
      case 'BobCoordinationIssue': { const issue = find(v.id); return send(200, issue ? { data: { issue: view(issue) } } : { data: null, errors: [{ message: 'Entity not found: Issue' }] }); }
      case 'BobCoordinationStates': return send(200, { data: { workflowStates: { nodes: v.teamId === teamId ? states : [] } } });
      case 'BobCoordinationState': { const issue = uuidOnly(v.id); if (!issue) return send(200, { data: null, errors: [{ message: 'Argument Validation Error: id must be a UUID' }] }); issue.stateId = v.stateId; return send(200, { data: { issueUpdate: { success: true } } }); }
      case 'BobCoordinationComment': { const issue = uuidOnly(v.issueId); if (!issue) return send(200, { data: null, errors: [{ message: 'Argument Validation Error' }] }); const comment = { id: randomUUID(), body: v.body }; issue.comments.push(comment); return send(200, { data: { commentCreate: { success: true, comment: { id: comment.id } } } }); }
      case 'BobCoordinationComments': { const issue = uuidOnly(v.id); return send(200, { data: { issue: issue ? { id: issue.id, comments: { nodes: issue.comments } } : null } }); }
      default: return send(400, { errors: [{ message: 'Unknown operation' }] });
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  fake.endpoint = `http://127.0.0.1:${server.address().port}/graphql`;
  fake.close = async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; };
  fake.mutations = () => calls.filter(call => /^mutation/.test(call.body.query.trim()));
  return fake;
}

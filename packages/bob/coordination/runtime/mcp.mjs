import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { CoordinationError, fail } from './coordinator.mjs';

const api = JSON.parse(readFileSync(new URL('../generated/openapi.json', import.meta.url)));
const specs = new Map(Object.values(api.paths).flatMap(Object.values).filter(operation => operation.operationId)
  .map(operation => [operation.operationId.split('/').at(-1), operation]));
const reads = new Set(['GetCapabilities', 'ListPlans', 'GetPlan', 'GetItem', 'GetOperation', 'ReadEvents']);
// The supervisor cannot mint execution/delivery evidence. Environment receipts
// stay on the authenticated REST port, even if a principal is misconfigured.
const management = new Set([...reads, 'CreatePlan', 'UpdatePlan', 'ControlPlan', 'RequestExecution', 'RetryItem']);
const toolName = operation => `bob_${operation.replace(/[A-Z]/g, (letter, offset) => `${offset ? '_' : ''}${letter.toLowerCase()}`)}`;
const descriptions = {
  GetCapabilities: 'Discover the implemented operations permitted for this supervisor. Does not certify runner health or delivery.',
  ListPlans: 'List durable Bob plans owned by this principal; follow nextPlanId with afterPlanId for further pages.',
  GetPlan: 'Read a plan, its current version, item states and atomic event cursor. Supply its ID as resourceId.',
  GetItem: 'Read an item, its current attempt, admitted execution, evidence references and atomic event cursor.',
  GetOperation: 'Recover the durable receipt for an operation after an uncertain response or supervisor restart.',
  ReadEvents: 'Read bounded durable change events after a snapshot cursor; fetch changed resources to reconcile. Reload a snapshot after CursorExpired.',
  CreatePlan: 'Create a draft issue-linked dependency plan. Does not dispatch work. Retain commandId and the exact payload across uncertain retries.',
  UpdatePlan: 'Update a draft or paused plan before any execution attempt, using expectedVersion. Retain commandId across uncertain retries.',
  ControlPlan: 'Start, pause, resume or cancel a plan using expectedVersion. Pause stops new dispatch; live attempts prevent cancellation. Retain commandId across uncertain retries.',
  RequestExecution: 'Reserve one ready item in an active plan for the Bob dispatch worker. Retain requestId, attemptId and the exact payload across uncertain retries. Accepted means queued, not executed.',
  RetryItem: 'Deliberately retry a confirmed failed or cancelled current attempt, with expectedVersion and previousAttemptId. Unknown execution must be reconciled first. Retain commandId across uncertain retries.',
};
export const supervisorInstructions = `You supervise the software factory through Bob. Bob owns plans, dependency/concurrency policy, durable attempt admission and dispatch. T3 owns environment-local execution; Kanbanger owns desired work; ForgeGraph and Preflight own independent delivery evidence.
1. Discover capabilities and recover existing plans before creating work. Use only operator-authorized issue projects, repositories, targets and execution profiles. Tool schemas do not grant additional authority.
2. Create a scoped issue-linked draft plan with explicit acceptance and dependency milestones. Start it only within the user's standing authorization. GetPlan and GetItem supply current versions; do not guess them.
3. RequestExecution reserves an eligible item; the existing Bob worker performs dispatch. An independent ready item needs its own request. Never launch a competing T3 execution for the same item.
4. Save mutation IDs, exact payloads, operation/resource IDs and event cursors in durable supervisor context. MCP request IDs are transport correlation only. The adapter derives Idempotency-Key from commandId or requestId. Reuse the same payload and IDs after a lost response, including after restart. Do not put Idempotency-Key on a shared MCP connection.
5. Read snapshots and bounded events after wake-ups; recover a lost cursor with a new snapshot. On VersionConflict, read current state before a deliberate new command. Unknown execution retains its slot: let Bob reconcile before retrying. RetryItem is for a confirmed terminal failed/cancelled attempt only.
6. Pause a plan to stop future dispatch. Pausing does not kill admitted work; active cancellation and automated validation/release/deployment are not implemented here. Report unsupported actions truthfully.
7. A completed agent turn is execution evidence only. Require current-head CI, review and declared-target deployment/health evidence for delivery. Never self-submit receipts, invent milestones, or mark a production issue Done from an agent's narrative.
8. Group routine outcomes into digests; escalate concrete decisions with issue/attempt/evidence links. This interface does not yet enforce portfolio spend ceilings or acquire arbitrary ready backlog items.`;

function toolResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError };
}
function problem(error) {
  if (!(error instanceof CoordinationError)) return { code: 'InternalError', status: 500, retryable: true, message: 'Bob could not confirm this operation. Retain the same mutation identifiers and exact payload before retrying.' };
  return { code: error.code, status: error.status, retryable: error.status >= 500, message: error.message };
}

/** A stateless MCP connection is only a transport. All authority and durable
 * state belong to the same authenticated coordinator used by REST. */
export async function handleMcp(request, response, body, service) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST for stateless Streamable HTTP MCP.' } }));
    return;
  }
  // Do not accept header-level mutation keys: a connection can run several
  // independent commands and their durable keys belong to the tool arguments.
  if (request.headers['idempotency-key'] !== undefined) fail('InvalidRequest', 'MCP mutation keys belong in commandId/requestId tool arguments, not HTTP headers', 400);
  const capabilities = await service.coordinator.admit('GetCapabilities', { contractVersion: '1' });
  const operations = capabilities.operations.filter(operation => management.has(operation) && service.operations.has(operation));
  const tools = new Map(operations.map(operation => [toolName(operation), operation]));
  // Project/target IDs are needed to form a valid plan. Project only these
  // policy fields; never serialize the principal, token or receipt authority.
  const scope = {
    workspaceId: service.coordinator.context.workspaceId,
    targets: service.coordinator.context.targets.map(({ environmentId, projectId, repository }) => ({ environmentId, projectId,
      repository: { integrationId: repository.integrationId, repositoryId: repository.repositoryId } })),
    issueProjects: service.coordinator.context.issueProjects.map(({ integrationId, workspaceId, teamId, projectId }) => ({ integrationId, workspaceId, teamId, projectId })),
  };
  const instructions = `${supervisorInstructions}\nConfigured scope for this connection (not runner health or permission to expand scope):\n${JSON.stringify(scope)}`;
  const server = new Server({ name: 'bob-coordination', version: '0.1.0' }, {
    capabilities: { tools: {}, prompts: {} }, instructions,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools].map(([name, operation]) => ({
    name, title: operation, description: descriptions[operation],
    inputSchema: specs.get(operation).requestBody.content['application/json'].schema,
    annotations: { readOnlyHint: reads.has(operation), destructiveHint: operation === 'ControlPlan', idempotentHint: true, openWorldHint: !reads.has(operation) },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const operation = tools.get(params.name);
    if (!operation) return toolResult({ code: 'CapabilityUnavailable', status: 403, retryable: false, message: 'Tool is not implemented or is outside this principal policy.' }, true);
    try {
      const input = params.arguments ?? {};
      const value = await service.coordinator.admit(operation, input, { idempotencyKey: input.commandId ?? input.requestId });
      if (operation === 'GetCapabilities') value.operations = operations;
      return toolResult(value);
    } catch (error) { return toolResult(problem(error), true); }
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'factory-supervisor', description: 'Resume a durable Bob software factory through scoped tools, stable mutation IDs and independent delivery evidence.' }] }));
  server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
    if (params.name !== 'factory-supervisor') throw new McpError(ErrorCode.InvalidParams, 'Unknown prompt');
    return { description: 'Bob software factory supervisor', messages: [{ role: 'user', content: { type: 'text', text: instructions } }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.once('close', () => { void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    await server.close();
    throw error;
  }
}

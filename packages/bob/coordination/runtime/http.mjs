import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ExecutionCoordinator } from './execution.mjs';
import { fail } from './coordinator.mjs';

const api = JSON.parse(readFileSync(new URL('../generated/openapi.json', import.meta.url)));
const routes = new Map(Object.entries(api.paths).flatMap(([path, methods]) => Object.entries(methods)
  .filter(([, operation]) => operation.operationId).map(([method, operation]) => [`${method.toUpperCase()} ${path}`, operation.operationId.split('/').at(-1)])));
const hash = value => createHash('sha256').update(value).digest();
const operationNames = new Set(routes.values());

/** Principals and their policies are operator-owned. Request headers/body cannot
 * select an actor, workspace, receipt identity or a wider target policy. */
export function coordinationServer({ database, principals, maxBodyBytes = 1024 * 1024 }) {
  if (!Array.isArray(principals) || !principals.length || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 4 * 1024 * 1024) fail('InvalidRequest', 'Invalid server configuration', 400);
  const digests = new Set();
  const services = [];
  try {
    for (const principal of principals) {
      if (typeof principal.token !== 'string' || principal.token.length < 32 || !Array.isArray(principal.operations) || principal.operations.some(name => !operationNames.has(name))) fail('InvalidRequest', 'A principal needs a unique token of at least 32 characters and declared operations', 400);
      const tokenHash = hash(principal.token), fingerprint = tokenHash.toString('hex');
      if (digests.has(fingerprint)) fail('InvalidRequest', 'Duplicate principal credential', 400);
      digests.add(fingerprint);
      services.push({ tokenHash, operations: new Set(principal.operations), coordinator: new ExecutionCoordinator({ database, context: principal.context }) });
    }
  } catch (error) { for (const service of services) service.coordinator.close(); throw error; }
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const credential = typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
      const presented = hash(credential);
      const service = services.find(candidate => timingSafeEqual(candidate.tokenHash, presented));
      if (!service) fail('Unauthorized', 'Authentication required', 401);
      const name = routes.get(`${request.method} ${new URL(request.url, 'http://localhost').pathname}`);
      if (!name) fail('NotFound', 'Coordination route not found', 404);
      if (!service.operations.has(name)) fail('Forbidden', 'Operation is outside the principal policy', 403);
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('InvalidRequest', 'Expected application/json', 415);
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBodyBytes) fail('InvalidRequest', 'Request body exceeds the configured limit', 413);
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('InvalidRequest', 'Expected a JSON request', 400); }
      const value = service.coordinator.call(name, input, { idempotencyKey: request.headers['idempotency-key'] });
      // Capabilities reflect both implementation and this principal's authority.
      if (name === 'GetCapabilities') value.operations = value.operations.filter(operation => service.operations.has(operation));
      response.writeHead(200); response.end(JSON.stringify(value));
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      response.writeHead(status);
      response.end(JSON.stringify({ type: 'about:blank', title: status === 500 ? 'Internal error' : error.message, status, code: error.code ?? 'InternalError', retryable: status >= 500 }));
      if (status === 413) request.resume();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on('close', () => { for (const service of services) service.coordinator.close(); });
  return server;
}

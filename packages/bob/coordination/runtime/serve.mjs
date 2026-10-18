#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { coordinationServer } from './http.mjs';
import { kanbangerClient, kanbangerIssueResolver, loadKanbangerConfig } from './kanbanger.mjs';
try {
  const { values } = parseArgs({ options: { database: { type: 'string' }, principals: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '4780' }, kanbanger: { type: 'string' } } });
  if (!values.database || !values.principals) throw new Error('Use --database <sqlite> --principals <operator-owned.json> [--host <address>] [--port <port>] [--kanbanger <kanbanger.json>]');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const server = coordinationServer({ database: values.database, principals: JSON.parse(readFileSync(values.principals, 'utf8')),
    issueResolver: values.kanbanger ? kanbangerIssueResolver(kanbangerClient(loadKanbangerConfig(values.kanbanger))) : undefined });
  server.on('error', error => { console.error(JSON.stringify({ code: 'ServerUnavailable', message: error.message })); process.exitCode = 1; });
  server.listen(port, values.host, () => console.log(JSON.stringify({ listening: server.address() })));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeIdleConnections(); });
} catch (error) { console.error(JSON.stringify({ code: error.code ?? 'InvalidRequest', message: error.message })); process.exitCode = 1; }

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { compiler } from './compiler.mjs';
import ts from 'typescript';
import { writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv[2];
assert(['--check', '--write'].includes(mode), 'Specify --check or --write');
const out = mkdtempSync(join(tmpdir(), 'bob-coordination-generated-'));
try {
  const forgec = compiler();
  execFileSync(forgec, ['check', root], { stdio: 'inherit' });
  execFileSync(forgec, ['build', root, '--service-id', 'bob', '--out', out], { stdio: 'inherit' });
  // forgec may warn and omit contract.json while returning zero. Require it.
  const contract = JSON.parse(readFileSync(join(out, 'contract.json'), 'utf8'));
  assert.equal(contract.serviceId, 'bob');
  assert.equal(contract.apiId, '@bob/coordination');
  assert(contract.operations.length === 23, 'Coordination operations missing');
  mkdirSync(join(root, 'generated'), { recursive: true });
  for (const name of ['openapi.json', 'contract.json', 'client.ts']) {
    if (mode === '--write') copyFileSync(join(out, name), join(root, 'generated', name));
    else assert.equal(readFileSync(join(out, name), 'utf8'), readFileSync(join(root, 'generated', name), 'utf8'), name + ' is stale; run npm run generate');
  }
  const clientJs = ts.transpileModule(readFileSync(join(out, 'client.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  if (mode === '--write') writeFileSync(join(root, 'generated/client.mjs'), clientJs);
  else assert.equal(readFileSync(join(root, 'generated/client.mjs'), 'utf8'), clientJs, 'Runtime client is stale');
  const storageOut = join(out, 'storage');
  const storageRoot = join(root, 'storage');
  execFileSync(forgec, ['check', storageRoot], { stdio: 'inherit' });
  execFileSync(forgec, ['build', storageRoot, '--out', storageOut], { stdio: 'inherit' });
  mkdirSync(join(storageRoot, 'generated'), { recursive: true });
  for (const dialect of ['d1', 'postgres']) {
    const generated = join(storageOut, dialect, '0001_init.sql');
    const committed = join(storageRoot, 'generated', dialect + '.sql');
    if (mode === '--write') copyFileSync(generated, committed);
    else assert.equal(readFileSync(generated, 'utf8'), readFileSync(committed, 'utf8'), dialect + ' storage SQL is stale');
  }
  const migration = readFileSync(join(storageOut, 'd1/0001_init.sql'), 'utf8').match(/CREATE TABLE coordination_attempt \([\s\S]*?\n\);/)[0] + '\n' + readFileSync(join(storageOut, 'd1/0001_init.sql'), 'utf8').split('\n').filter(line => line.startsWith('CREATE') && line.includes(' ON coordination_attempt ')).join('\n') + '\n';
  const migrationFile = join(storageRoot, 'generated/0002_attempts.sql');
  if (mode === '--write') writeFileSync(migrationFile, migration);
  else assert.equal(readFileSync(migrationFile, 'utf8'), migration, 'Attempt migration is stale');
  console.log('ForgeC coordination artifacts ' + (mode === '--write' ? 'generated' : 'reproduce exactly'));
} finally {
  rmSync(out, { recursive: true, force: true });
}

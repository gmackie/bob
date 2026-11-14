// Generates src/generated/contract.ts from the coordinator's OpenAPI, so the
// state, plan-state and milestone enums can't drift from the contract.
//   node scripts/generate-contract.mjs --write   regenerate
//   node scripts/generate-contract.mjs --check   fail if the checked-in file is stale
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const api = JSON.parse(readFileSync(new URL('../../../coordination/generated/openapi.json', import.meta.url), 'utf8'));
const out = new URL('../src/generated/contract.ts', import.meta.url);

const response = path => {
  const schema = api.paths[path]?.post?.responses?.['200']?.content?.['application/json']?.schema;
  if (!schema) throw new Error(`openapi.json has no POST 200 response schema for ${path}`);
  return schema;
};
const enumOf = (where, schema) => {
  if (!Array.isArray(schema?.enum) || schema.enum.length === 0) throw new Error(`openapi.json: ${where} is not an enum`);
  return schema.enum;
};

const item = response('/api/v1/coordination/items/query').properties.item.properties;
const plan = response('/api/v1/coordination/plans/query').properties;
// Emits Prettier-formatted source (default printWidth 80, double quotes, trailing
// commas), so formatting the package never rewrites this generated file and --check stays stable.
const PRINT_WIDTH = 80;
const list = (name, values) => {
  const quoted = values.map(value => JSON.stringify(value));
  const line = `export const ${name} = [${quoted.join(', ')}] as const;`;
  return line.length <= PRINT_WIDTH ? `${line}\n` : `export const ${name} = [\n${quoted.map(v => `  ${v},\n`).join('')}] as const;\n`;
};
const source = '// Generated from packages/bob/coordination/generated/openapi.json. Do not edit.\n'
  + '// Regenerate: pnpm --filter @bob/sdlc-view generate\n'
  + list('ITEM_STATES', enumOf('GetItem item.state', item.state))
  + list('PLAN_STATES', enumOf('GetPlan state', plan.state))
  + list('MILESTONES', enumOf('GetItem item.achievedMilestones[]', item.achievedMilestones?.items))
  + 'export type ItemState = (typeof ITEM_STATES)[number];\n'
  + 'export type PlanState = (typeof PLAN_STATES)[number];\n'
  + 'export type Milestone = (typeof MILESTONES)[number];\n';

if (process.argv.includes('--write')) {
  mkdirSync(new URL('.', out), { recursive: true });
  writeFileSync(out, source);
} else if (!existsSync(out) || readFileSync(out, 'utf8') !== source) {
  console.error('src/generated/contract.ts is missing or stale; run: pnpm --filter @bob/sdlc-view generate');
  process.exit(1);
}

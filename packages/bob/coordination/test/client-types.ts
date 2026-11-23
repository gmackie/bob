import type { ForgeClient, SubmitExecutionInput, CreatePlanInput } from '../generated/client.js';
declare const client: ForgeClient;
declare const execution: SubmitExecutionInput;
declare const plan: CreatePlanInput;
const admission = await client.functions.submitExecution(execution, { idempotencyKey: execution.requestId });
const environment: string = admission.target.environmentId;
const operation = await client.functions.createPlan(plan, { idempotencyKey: plan.commandId });
const state: 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled' = operation.state;
// @ts-expect-error an execution needs explicit scope and target
client.functions.submitExecution({ requestId: 'request-1' });
// @ts-expect-error nested repository identity remains typed
execution.target.repository.repositoryId = 123;
// @ts-expect-error execution admission is not deployment evidence
admission.healthEvidenceRefs;
// @ts-expect-error completion target is a closed enum
plan.plan.items[0].completionTarget = 'done';
void environment;
void state;

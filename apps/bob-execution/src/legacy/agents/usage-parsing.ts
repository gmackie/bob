// Shared helpers for parsing token-usage information out of CLI agent
// stdout. Different agent CLIs emit slightly different JSON shapes on
// stdout (some as `{ usage: {...} }`, some as `{ tokens: {...} }`, some
// nested under `metadata.tokens`), so these helpers narrow `unknown` into
// a common shape rather than trusting `any` from `JSON.parse`.

export interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

function isUsageFields(value: unknown): value is UsageFields {
  return typeof value === 'object' && value !== null;
}

export interface GenericUsagePayload {
  usage?: UsageFields;
  tokens?: UsageFields;
  metadata?: {
    tokens?: {
      input?: number;
      output?: number;
      cost?: number;
    };
  };
}

export function isGenericUsagePayload(
  value: unknown,
): value is GenericUsagePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if ('usage' in value && value.usage !== undefined && !isUsageFields(value.usage)) {
    return false;
  }
  if ('tokens' in value && value.tokens !== undefined && !isUsageFields(value.tokens)) {
    return false;
  }
  return true;
}

/** Pick whichever usage-shaped field is present: `usage` takes priority over `tokens`. */
export function extractUsageFields(
  payload: GenericUsagePayload,
): UsageFields | undefined {
  return payload.usage ?? payload.tokens;
}

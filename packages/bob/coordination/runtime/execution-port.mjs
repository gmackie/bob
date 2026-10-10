import { createClient } from '../generated/client.mjs';
import { canonical, fail, outputValidators } from './coordinator.mjs';

/** Each binding and credential is environment-local configuration. Credentials
 * never enter the persisted execution request. No legacy T3 dispatch fallback. */
export function executionPort({ bindings, fetch: transport = fetch, timeoutMs = 15000 }) {
  if (!Array.isArray(bindings) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('InvalidRequest', 'Invalid environment bindings/timeout', 400);
  const client = request => {
    const matches = bindings.filter(binding => canonical(binding.target) === canonical(request.target));
    if (matches.length !== 1) fail('TargetMismatch', 'Exactly one local binding must match the full execution target');
    const binding = matches[0];
    const base = new URL(binding.baseUrl);
    if (base.username || base.password || !['https:', 'http:'].includes(base.protocol)) fail('InvalidRequest', 'Invalid environment base URL', 400);
    return createClient({ baseUrl: base.toString(), headers: binding.authToken ? { Authorization: `Bearer ${binding.authToken}` } : {},
      fetch: (url, options) => transport(url, { ...options, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }) });
  };
  return {
    async requireCapabilities(request) {
      const capabilities = await client(request).functions.getCapabilities({ contractVersion: '1' });
      if (!outputValidators.get('GetCapabilities')(capabilities) || !capabilities.durableExecutionAdmission || !['SubmitExecution', 'FindExecution'].every(name => capabilities.operations.includes(name)) || !capabilities.executionProfiles.includes(request.executionProfileId)) {
        fail('CapabilityUnavailable', 'Environment lacks durable admission/lookup or the selected execution profile', 501);
      }
    },
    async submit(request) {
      return client(request).functions.submitExecution(request, { idempotencyKey: request.requestId });
    },
    async find(request) {
      try { return await client(request).functions.findExecution({ contractVersion: '1', requestId: request.requestId, environmentId: request.target.environmentId }); }
      catch (error) { if (error.code === 'NotFound' && error.status === 404) return null; throw error; }
    },
  };
}

import { validateTraceCarrier } from "@gmacko/core/telemetry/deep";

/** Only the validated W3C carrier may cross from persisted persona metadata. */
export function readDispatchTrace(persona: unknown) {
  if (!persona || typeof persona !== "object") return undefined;
  const metadata = (persona as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return validateTraceCarrier(
    (metadata as Record<string, unknown>).traceCarrier,
  );
}

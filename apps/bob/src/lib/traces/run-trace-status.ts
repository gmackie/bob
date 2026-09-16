/** Server-side lookup: callers must authorize the run before passing it here. */
export type TraceStorageState =
  | "stored"
  | "pending"
  | "sampled_out"
  | "unavailable";
export interface RunTraceStatus {
  artifactId: string;
  state: TraceStorageState;
  checkedAt?: string;
}
interface TraceArtifact {
  id: string;
  createdAt?: Date | string;
  metadata?: Record<string, unknown> | null;
}
interface OwnedRun {
  sessionId?: string | null;
  artifacts: TraceArtifact[];
}
interface Config {
  baseUrl: string;
  token: string;
}
const validId = (value: unknown, length: number): value is string =>
  typeof value === "string" &&
  new RegExp(`^[0-9a-f]{${length}}$`).test(value) &&
  !/^0+$/.test(value);
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Trace lookup unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error("Trace lookup response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function getRunTraceStatuses(
  run: OwnedRun,
  config: Config | null,
  transport: typeof fetch = fetch,
): Promise<RunTraceStatus[]> {
  const artifacts = run.artifacts
    .filter((a) => a.metadata?.kind === "trace_reference")
    .sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return (Number.isFinite(timeA) ? timeA : 0) - (Number.isFinite(timeB) ? timeB : 0) || a.id.localeCompare(b.id);
    })
    .slice(-100);
  const statuses: RunTraceStatus[] = artifacts.map((a) => ({
    artifactId: a.id,
    state: a.metadata?.sampled === false ? "sampled_out" : "unavailable",
  }));
  let endpoint: URL;
  try {
    if (
      !config?.token ||
      !run.sessionId ||
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(run.sessionId)
    )
      return statuses;
    const base = new URL(config.baseUrl);
    if (
      base.origin !== "https://forgegraf.com" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return statuses;
    endpoint = new URL("/api/fg/telemetry/trace-presence", base);
  } catch {
    return statuses;
  }
  const eligible = artifacts.flatMap((artifact, index) => {
    const metadata = artifact.metadata!;
    if (
      metadata.sampled !== true ||
      !validId(metadata.traceId, 32) ||
      !validId(metadata.spanId, 16)
    )
      return [];
    const date = artifact.createdAt ? new Date(artifact.createdAt) : undefined;
    return [
      {
        index,
        reference: {
          traceId: metadata.traceId,
          spanId: metadata.spanId,
          correlation: { key: "session.id", value: run.sessionId },
          ...(date && Number.isFinite(date.getTime())
            ? { observedAt: date.toISOString() }
            : {}),
        },
      },
    ];
  });
  const batches = Array.from(
    { length: Math.ceil(eligible.length / 20) },
    (_, index) => eligible.slice(index * 20, index * 20 + 20),
  );
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const response = await transport(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config!.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ references: batch.map((r) => r.reference) }),
          signal: AbortSignal.timeout(3_000),
          redirect: "error",
          cache: "no-store",
        });
        const data = (await boundedJson(response)) as { results?: unknown };
        if (!Array.isArray(data.results) || data.results.length > 20) return;
        for (const { index, reference } of batch) {
          const matches = data.results.filter(
            (r: unknown) =>
              r &&
              typeof r === "object" &&
              (r as Record<string, unknown>).traceId === reference.traceId &&
              (r as Record<string, unknown>).spanId === reference.spanId,
          );
          if (matches.length !== 1) continue;
          const result = matches[0] as Record<string, unknown>;
          const state =
            result.state === "stored" && result.matchedSpanCount === 1
              ? "stored"
              : result.state === "pending" && result.matchedSpanCount === 0
                ? "pending"
                : "unavailable";
          statuses[index] = {
            artifactId: artifacts[index]!.id,
            state,
            ...(typeof result.checkedAt === "string" &&
            Number.isFinite(Date.parse(result.checkedAt))
              ? { checkedAt: result.checkedAt }
              : {}),
          };
        }
      } catch {
        /* A storage query must never turn a readable run into an error. */
      }
    }),
  );
  return statuses;
}

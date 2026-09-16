"use client";
import type { TraceStorageState } from "~/lib/traces/run-trace-status";
const labels: Record<TraceStorageState, string> = {
  stored: "Stored in trace backend",
  pending: "Awaiting trace export",
  sampled_out: "Not sampled",
  unavailable: "Storage not verified",
};
export function TraceStorageLink({
  runId,
  artifactId,
  state,
  checking,
  onRefresh,
}: {
  runId: string;
  artifactId: string;
  state: TraceStorageState;
  checking: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span role="status" className="text-muted-foreground">
        {checking ? "Checking trace storage…" : labels[state]}
      </span>
      {state !== "sampled_out" && (
        <>
          <a
            href={`/api/runs/${encodeURIComponent(runId)}/traces/${encodeURIComponent(artifactId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            {state === "stored" ? "Open stored trace" : "Open trace viewer"}
          </a>
          <button
            type="button"
            onClick={onRefresh}
            disabled={checking}
            className="text-primary underline disabled:opacity-50"
          >
            Refresh storage check
          </button>
        </>
      )}
    </div>
  );
}

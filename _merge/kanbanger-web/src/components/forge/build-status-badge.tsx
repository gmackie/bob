import { Badge } from "@linear-clone/ui";

type BuildStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "canceled"
  | "superseded";

const statusLabel: Record<BuildStatus, string> = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  canceled: "Canceled",
  superseded: "Superseded",
};

export function BuildStatusBadge({ status }: { status: BuildStatus }) {
  return <Badge variant="secondary">{statusLabel[status] ?? status}</Badge>;
}

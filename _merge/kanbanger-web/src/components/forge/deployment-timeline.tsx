import { Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui";

interface DeploymentItem {
  id: string;
  environment: string;
  status: string;
  revId: string;
  createdAt: Date | string;
}

const statusLabel: Record<string, string> = {
  pending_approval: "Pending approval",
  queued: "Queued",
  building: "Building",
  testing: "Testing",
  deploying: "Deploying",
  verifying: "Verifying",
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  rolled_back: "Rolled back",
  failed: "Failed",
};

function formatDeploymentStatus(status: string) {
  return statusLabel[status] ?? status;
}

export function DeploymentTimeline({ deployments }: { deployments: DeploymentItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deployment Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {deployments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deployments yet.</p>
        ) : (
          deployments.map((deployment) => (
            <div key={deployment.id} className="rounded border p-3">
              <p className="text-sm font-medium">
                {deployment.environment} - {formatDeploymentStatus(deployment.status)}
              </p>
              <p className="text-xs text-muted-foreground">rev: {deployment.revId}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(deployment.createdAt).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

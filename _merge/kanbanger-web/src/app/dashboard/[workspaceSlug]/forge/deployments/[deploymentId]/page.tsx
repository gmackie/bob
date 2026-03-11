"use client";

import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui";

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

export default function ForgeDeploymentDetailPage() {
  const params = useParams();
  const deploymentId = decodeURIComponent(params.deploymentId as string);

  const { data: deployment, isLoading } = api.forgeDeployment.get.useQuery(
    { deploymentId },
    { enabled: !!deploymentId }
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Deployment Detail</h1>
        <p className="font-mono text-xs text-muted-foreground">{deploymentId}</p>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Deployment Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading deployment...</p>
            ) : deployment ? (
                <div className="space-y-2">
                <Badge variant="secondary">{formatDeploymentStatus(deployment.status)}</Badge>
                <p className="text-sm">
                  <span className="text-muted-foreground">Environment:</span> {deployment.environment}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Build:</span> {deployment.buildId}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Revision:</span> {deployment.revId}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Deployment not found.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

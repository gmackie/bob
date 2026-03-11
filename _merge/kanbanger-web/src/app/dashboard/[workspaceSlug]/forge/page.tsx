"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { api } from "@/lib/trpc/client";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui";

import { BuildStatusBadge } from "@/components/forge/build-status-badge";
import { DeploymentTimeline } from "@/components/forge/deployment-timeline";
import { ForgeRevisionCard } from "@/components/forge/forge-revision-card";

export default function ForgeOverviewPage() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug as string;

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: repositories, isLoading: repositoriesLoading } =
    api.forgeRepository.list.useQuery(
      { workspaceId: workspace?.id ?? "" },
      { enabled: !!workspace?.id }
    );

  const selectedRepoId = repositories?.[0]?.id;

  const { data: revisions, isLoading: revisionsLoading } = api.forgeRevision.list.useQuery(
    { repoId: selectedRepoId ?? "", limit: 20 },
    { enabled: !!selectedRepoId }
  );

  const { data: stagingDeployments } = api.forgeDeployment.listByEnvironment.useQuery({
    environment: "staging",
    limit: 10,
  });

  const latestDeployment = stagingDeployments?.[0];
  const { data: latestBuild } = api.forgeBuild.get.useQuery(
    { buildId: latestDeployment?.buildId ?? "" },
    { enabled: !!latestDeployment?.buildId }
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">ForgeGraph</h1>
        <p className="text-sm text-muted-foreground">
          JJ metadata viewer and revision-centric CI/CD observability
        </p>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Repositories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {repositoriesLoading ? (
                <p className="text-sm text-muted-foreground">Loading repositories...</p>
              ) : repositories && repositories.length > 0 ? (
                repositories.map((repo) => (
                  <div key={repo.id} className="rounded-md border p-3">
                    <p className="font-medium">{repo.name}</p>
                    <p className="text-xs text-muted-foreground">{repo.storageBackend}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No repositories indexed yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latest Build</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestBuild ? (
                <>
                  <BuildStatusBadge status={latestBuild.status} />
                  <p className="font-mono text-sm text-muted-foreground">{latestBuild.id}</p>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/${workspaceSlug}/forge/builds/${latestBuild.id}`}>
                      View Build Detail
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No builds recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Revisions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {revisionsLoading ? (
                <p className="text-sm text-muted-foreground">Loading revisions...</p>
              ) : revisions && revisions.length > 0 ? (
                revisions.map((revision) => (
                  <div key={revision.id} className="space-y-2">
                    <ForgeRevisionCard
                      revId={revision.revId}
                      description={revision.description}
                      indexedAt={revision.indexedAt}
                    />
                    <div className="flex justify-end">
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/dashboard/${workspaceSlug}/forge/revs/${encodeURIComponent(
                            revision.revId
                          )}?repoId=${revision.repoId}`}
                        >
                          View revision
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No revisions indexed yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Staging Deployments</CardTitle>
            </CardHeader>
            <CardContent>
              <DeploymentTimeline deployments={stagingDeployments ?? []} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

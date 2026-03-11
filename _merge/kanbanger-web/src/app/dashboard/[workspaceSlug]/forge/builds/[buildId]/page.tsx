"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { api } from "@/lib/trpc/client";
import { Badge, Button, Card, CardContent, CardHeader } from "@linear-clone/ui";
import { BuildStatusBadge } from "@/components/forge/build-status-badge";
import { formatDuration } from "@/lib/forge/review-data";

export default function ForgeBuildDetailPage() {
  const params = useParams();
  const buildId = decodeURIComponent(params.buildId as string);
  const workspaceSlug = params.workspaceSlug as string;

  const { data: build, isLoading: buildLoading } = api.forgeBuild.get.useQuery(
    { buildId },
    { enabled: !!buildId }
  );

  const { data: artifacts, isLoading: artifactsLoading } = api.forgeBuild.listArtifacts.useQuery(
    { buildId },
    { enabled: !!buildId }
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Build Detail</p>
        <h1 className="text-lg font-semibold">{build?.status ? "Build Status" : "Build Detail"}</h1>
        <p className="font-mono text-xs text-muted-foreground">{buildId}</p>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-base font-semibold leading-none tracking-tight">
              Build Metadata
            </h2>
          </CardHeader>
          <CardContent>
            {buildLoading ? (
                  <p className="text-sm text-muted-foreground">Loading build…</p>
            ) : build ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <BuildStatusBadge status={build.status} />
                  {build.externalJobId ? (
                    <Badge variant="outline">External Job: {build.externalJobId}</Badge>
                  ) : null}
                </div>
                <div className="grid gap-2 text-sm">
                  <p>
                    <span className="text-muted-foreground">Revision:</span>{" "}
                    <span className="font-mono break-all">{build.revId}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Repository:</span>{" "}
                    <span className="font-mono break-all">{build.repoId}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Run ID:</span>{" "}
                    <span className="font-mono break-all">{build.runId || "N/A"}</span>
                  </p>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">CI Provider:</span> {build.ciProvider}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Image digest:</span>{" "}
                  {build.imageDigest || "N/A"}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Started:</span>{" "}
                  {build.startedAt ? new Date(build.startedAt).toLocaleString() : "Not started"}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Completed:</span>{" "}
                  {build.completedAt ? new Date(build.completedAt).toLocaleString() : "In progress"}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Duration:</span>{" "}
                  {formatDuration(build.startedAt, build.completedAt)}
                </p>
                {build.revId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/dashboard/${workspaceSlug}/forge/revs/${encodeURIComponent(build.revId)}?repoId=${build.repoId}`}
                    >
                      View parent revision
                    </Link>
                  </Button>
                ) : null}
                {build.runId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/${workspaceSlug}/forge/runs/${build.runId}`}>View run</Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Build not found.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold leading-none tracking-tight">
              Build Artifacts
            </h2>
          </CardHeader>
          <CardContent>
            {artifactsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading artifacts…</p>
            ) : artifacts && artifacts.length > 0 ? (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"} attached
                </p>
                <ul className="space-y-3">
                  {artifacts.map((artifact) => (
                    <li key={artifact.id} className="rounded border p-2">
                      <p className="break-all font-mono text-sm">{artifact.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {artifact.digest ? `Digest: ${artifact.digest}` : "No digest"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Storage: {artifact.storageKey}
                      </p>
                      {artifact.sizeBytes ? (
                        <p className="text-xs text-muted-foreground">
                          Size: {artifact.sizeBytes} bytes
                        </p>
                      ) : null}
                      {artifact.metadata?.url ? (
                        <Button asChild size="sm" variant="outline">
                          <a
                            className="mt-2 inline-flex items-center gap-1"
                            href={String(artifact.metadata.url)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Download
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No artifacts attached yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

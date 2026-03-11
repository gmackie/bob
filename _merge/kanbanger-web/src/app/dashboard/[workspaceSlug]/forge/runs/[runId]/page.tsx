"use client";

import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui";

export default function ForgeRunDetailPage() {
  const params = useParams();
  const runId = decodeURIComponent(params.runId as string);

  const { data: runOverlay, isLoading } = api.forgeRun.get.useQuery(
    { runId },
    { enabled: !!runId }
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Run Detail</h1>
        <p className="font-mono text-xs text-muted-foreground">{runId}</p>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Run Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading run overlay...</p>
            ) : runOverlay ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>{runOverlay.status}</Badge>
                  {runOverlay.testStatus ? (
                    <Badge variant="secondary">tests: {runOverlay.testStatus}</Badge>
                  ) : null}
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">Revision:</span> {runOverlay.revId}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Repository:</span> {runOverlay.repoId}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Run overlay not found.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {runOverlay?.artifactRefs && runOverlay.artifactRefs.length > 0 ? (
              runOverlay.artifactRefs.map((artifact, idx) => (
                <div key={`${artifact.type}-${idx}`} className="rounded border p-2">
                  <p className="font-medium">{artifact.type}</p>
                  {artifact.url ? (
                    <a
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      href={artifact.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {artifact.url}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <p className="text-muted-foreground break-all">No URL</p>
                  )}
                  {artifact.description ? (
                    <p className="text-muted-foreground mt-1">{artifact.description}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No artifacts linked yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

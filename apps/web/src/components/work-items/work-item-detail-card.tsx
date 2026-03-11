import Link from "next/link";

interface WorkItemDetailCardProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    project: {
      id: string;
      name: string;
      key: string;
    } | null;
  };
  childCount: number;
  comments: Array<{
    id: string;
    body: string;
    userId: string;
    createdAt: Date;
  }>;
  currentArtifacts: Array<{
    id: string;
    artifactRole: string;
    url: string;
    title: string | null;
  }>;
}

export function WorkItemDetailCard({
  workItem,
  childCount,
  comments,
  currentArtifacts,
}: WorkItemDetailCardProps) {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.05] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-white/45">
              {workItem.identifier}
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-white">
              {workItem.title}
            </h1>
          </div>
          {workItem.project ? (
            <Link
              href={`/projects/${workItem.project.id}`}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 transition hover:border-white/20 hover:text-white"
            >
              {workItem.project.key} · {workItem.project.name}
            </Link>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3 text-sm text-white/55">
          <span>{workItem.kind}</span>
          <span>{workItem.status.replace(/_/g, " ")}</span>
          <span>{childCount} child item{childCount === 1 ? "" : "s"}</span>
          <span>{comments.length} comments</span>
        </div>

        <p className="mt-6 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-white/72">
          {workItem.description?.trim() || "No description yet."}
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
          <h2 className="text-lg font-semibold text-white">Discussion</h2>
          <div className="mt-4 space-y-4">
            {comments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                No comments yet.
              </div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
                >
                  <div className="text-xs text-white/35">{comment.userId}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-white/75">
                    {comment.body}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
          <h2 className="text-lg font-semibold text-white">Current Artifacts</h2>
          <div className="mt-4 space-y-3">
            {currentArtifacts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                No artifacts attached.
              </div>
            ) : (
              currentArtifacts.map((artifact) => (
                <a
                  key={artifact.id}
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                    {artifact.artifactRole}
                  </div>
                  <div className="mt-2 text-sm text-white">
                    {artifact.title?.trim() || artifact.url}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

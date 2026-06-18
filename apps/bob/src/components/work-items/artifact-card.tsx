interface Artifact {
  id: string;
  artifactRole: string;
  url: string;
  title: string | null;
}

const ROLE_ICONS: Record<string, string> = {
  CHANGE_SET: "\u{1F500}",
  PR: "\u{1F4CB}",
  BUILD: "\u{1F3D7}\u{FE0F}",
  TEST_RESULTS: "\u{2705}",
  DEPLOYMENT: "\u{1F680}",
  LOG: "\u{1F4C4}",
};

function getRoleIcon(role: string): string {
  return ROLE_ICONS[role] ?? "\u{1F4CE}";
}

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 rounded-2xl border border-border bg-accent px-4 py-4 transition hover:border-muted-foreground/30"
    >
      <span className="mt-0.5 text-lg leading-none" aria-hidden="true">
        {getRoleIcon(artifact.artifactRole)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {artifact.artifactRole}
        </div>
        <div className="mt-1 truncate text-sm text-foreground">
          {artifact.title?.trim() || artifact.url}
        </div>
      </div>
    </a>
  );
}

export function ArtifactCardGrid({
  artifacts,
}: {
  artifacts: Artifact[];
}) {
  if (artifacts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        No artifacts attached.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}

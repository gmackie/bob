import Link from "next/link";

interface ProjectCardProps {
  id: string;
  label: string;
  name: string;
  color: string | null;
  status: string;
  totals: string;
  activeLabel: string;
}

export function ProjectCard(props: ProjectCardProps) {
  return (
    <Link
      href={`/projects/${props.id}`}
      className="rounded-2xl border border-border bg-card p-5 transition hover:border-muted-foreground/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            {props.label}
          </div>
          <h3 className="mt-2 font-display text-lg font-semibold text-foreground">{props.name}</h3>
        </div>
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: props.color ?? "#6b7280" }}
        />
      </div>
      <div className="mt-4 text-sm text-secondary-foreground">{props.totals}</div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{props.activeLabel}</span>
        <span>{props.status.replace(/_/g, " ")}</span>
      </div>
    </Link>
  );
}

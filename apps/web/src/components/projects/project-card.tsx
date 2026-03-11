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
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-white/20 hover:bg-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-white/45">
            {props.label}
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">{props.name}</h3>
        </div>
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: props.color ?? "#6b7280" }}
        />
      </div>
      <div className="mt-4 text-sm text-white/70">{props.totals}</div>
      <div className="mt-2 flex items-center justify-between text-xs text-white/50">
        <span>{props.activeLabel}</span>
        <span>{props.status.replace(/_/g, " ")}</span>
      </div>
    </Link>
  );
}

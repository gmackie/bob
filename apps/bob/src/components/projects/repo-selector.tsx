"use client";

interface RepoOption {
  fullName: string;
  preferred: {
    provider: "gitea" | "github";
    instanceUrl: string | null;
    defaultBranch: string;
  };
}

interface RepoSelectorProps {
  options: RepoOption[];
  selectedFullName: string;
  onSelect: (fullName: string) => void;
  onMap: () => void;
  disabled?: boolean;
}

export function RepoSelector({
  options,
  selectedFullName,
  onSelect,
  onMap,
  disabled,
}: RepoSelectorProps) {
  const hasSelection = options.some((o) => o.fullName === selectedFullName);

  return (
    <div className="rounded-2xl border border-border bg-secondary p-5">
      <div className="text-sm font-medium text-foreground">Map a repository</div>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose one of your connected repositories and attach it to this
        planning project.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={selectedFullName}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-2xl border border-border bg-popover px-4 py-3 text-sm text-foreground outline-none transition focus:border-sky-400/50"
        >
          {options.length === 0 ? (
            <option value="">No connected repositories</option>
          ) : null}
          {options.map((option) => (
            <option key={option.fullName} value={option.fullName}>
              {option.fullName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-2xl bg-sky-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-500"
          onClick={onMap}
          disabled={disabled || !hasSelection}
        >
          Map repository
        </button>
      </div>
    </div>
  );
}

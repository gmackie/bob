import { cn } from "../utils";

interface PanelProps {
  children: React.ReactNode;
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return (
    <div
      className={cn(
        "flex h-full w-80 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

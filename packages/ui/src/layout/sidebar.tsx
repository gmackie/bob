import { cn } from "../utils";

interface SidebarProps {
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]",
        className,
      )}
    >
      {children}
    </aside>
  );
}

import { cn } from "../utils";
import { ThemeSwitcher } from "../theme-switcher";

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
      <div className="flex-1 overflow-auto">{children}</div>
      <div className="border-t border-[var(--color-border)] p-3">
        <ThemeSwitcher />
      </div>
    </aside>
  );
}

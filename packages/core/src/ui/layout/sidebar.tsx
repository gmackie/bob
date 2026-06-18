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
        "flex h-full w-64 flex-col border-r border-border bg-card",
        className,
      )}
    >
      <div className="flex-1 overflow-auto">{children}</div>
      <div className="border-t border-border p-3">
        <ThemeSwitcher />
      </div>
    </aside>
  );
}

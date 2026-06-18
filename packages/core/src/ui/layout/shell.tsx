import { cn } from "../utils";

interface ShellProps {
  sidebar?: React.ReactNode;
  panel?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Shell({ sidebar, panel, children, className }: ShellProps) {
  return (
    <div
      className={cn(
        "flex h-screen w-screen bg-background text-foreground",
        className,
      )}
    >
      {sidebar}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      {panel}
    </div>
  );
}

/**
 * Placeholder app shell — wraps children in a basic container.
 * Task 8 will port the full navigation and sidebar from apps/ooda.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}

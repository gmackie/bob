import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-4xl font-bold tracking-tight">OODA</h1>
      <nav className="flex flex-col gap-3 px-4 sm:flex-row sm:gap-4 sm:px-0">
        <Link
          href="/capture"
          className="border-border hover:bg-accent rounded-lg border px-5 py-3 text-center transition-colors sm:px-6 sm:py-4"
        >
          <div className="text-lg font-semibold">Capture</div>
          <div className="text-muted-foreground text-sm">Quick notes, imports, voice</div>
        </Link>
        <Link
          href="/research"
          className="border-border hover:bg-accent rounded-lg border px-5 py-3 text-center transition-colors sm:px-6 sm:py-4"
        >
          <div className="text-lg font-semibold">Research</div>
          <div className="text-muted-foreground text-sm">Topics, sources, KBs</div>
        </Link>
        <Link
          href="/threads"
          className="border-border hover:bg-accent rounded-lg border px-5 py-3 text-center transition-colors sm:px-6 sm:py-4"
        >
          <div className="text-lg font-semibold">Threads</div>
          <div className="text-muted-foreground text-sm">Agent sessions</div>
        </Link>
      </nav>
    </div>
  );
}

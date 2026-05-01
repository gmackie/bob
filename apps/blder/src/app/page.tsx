export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight">blder.bot</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The platform hub for your builder tools.
        </p>

        <nav className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a
            href="https://bob.blder.bot"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-6 py-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent"
          >
            bob.blder.bot
            <span className="text-muted-foreground" aria-hidden="true">
              &rarr;
            </span>
          </a>
          <a
            href="https://ooda.blder.bot"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-6 py-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent"
          >
            ooda.blder.bot
            <span className="text-muted-foreground" aria-hidden="true">
              &rarr;
            </span>
          </a>
        </nav>

        <div className="mt-12">
          <a
            href="/login"
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
          >
            Sign in
          </a>
        </div>
      </div>
    </main>
  );
}

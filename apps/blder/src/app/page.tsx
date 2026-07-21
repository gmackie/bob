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
          <a
            href="/nodes"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-6 py-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent"
          >
            Nodes
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

        <nav
          className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
          aria-label="Legal"
        >
          <a className="transition hover:text-foreground" href="/legal/terms">
            Terms
          </a>
          <a className="transition hover:text-foreground" href="/legal/privacy">
            Privacy
          </a>
          <a className="transition hover:text-foreground" href="/legal/dpa">
            DPA
          </a>
          <a
            className="transition hover:text-foreground"
            href="/legal/subprocessors"
          >
            Subprocessors
          </a>
          <a className="transition hover:text-foreground" href="/legal/security">
            Security
          </a>
          <a
            className="transition hover:text-foreground"
            href="/legal/data-deletion-export"
          >
            Data
          </a>
          <a className="transition hover:text-foreground" href="/legal/cookies">
            Cookies
          </a>
        </nav>
      </div>
    </main>
  );
}

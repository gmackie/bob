import { legalNavigation } from "./content";

export default function LegalIndexPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:py-14">
      <div className="mx-auto w-full max-w-4xl">
        <a
          href="/"
          className="text-sm font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
        >
          Home
        </a>
        <header className="mt-8 border-b border-border pb-8">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Legal
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Terms, privacy, processing, security, data, and cookie disclosures
            for blder.bot services.
          </p>
        </header>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {legalNavigation.map((page) => (
            <a
              key={page.slug}
              href={`/legal/${page.slug}`}
              className="rounded-lg border border-border bg-secondary p-4 transition hover:bg-accent"
            >
              <h2 className="text-base font-semibold">{page.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {page.summary}
              </p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}


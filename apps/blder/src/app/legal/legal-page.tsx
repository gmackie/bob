import { legalNavigation, type LegalPage as LegalPageContent } from "./content";

export function LegalPage({ page }: { page: LegalPageContent }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:py-14">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:flex-row">
        <aside className="lg:sticky lg:top-8 lg:h-fit lg:w-64 lg:shrink-0">
          <a
            href="/"
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
          >
            Home
          </a>
          <nav className="mt-6 grid gap-2" aria-label="Legal pages">
            {legalNavigation.map((item) => (
              <a
                key={item.slug}
                href={`/legal/${item.slug}`}
                className={[
                  "rounded-lg border px-3 py-2 text-sm transition",
                  item.slug === page.slug
                    ? "border-border bg-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground",
                ].join(" ")}
              >
                {item.title}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 flex-1">
          <header className="border-b border-border pb-8">
            <p className="text-sm font-medium text-muted-foreground">
              Last updated {page.lastUpdated}
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
              {page.summary}
            </p>
          </header>

          <div className="mt-8 space-y-10">
            {page.sections.map((section) => (
              <section key={section.title} className="space-y-4">
                <h2 className="text-xl font-semibold tracking-tight">
                  {section.title}
                </h2>

                {section.body?.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="max-w-3xl text-sm leading-7 text-muted-foreground"
                  >
                    {paragraph}
                  </p>
                ))}

                {section.bullets ? (
                  <ul className="grid max-w-3xl list-disc gap-2 pl-5 text-sm leading-7 text-muted-foreground">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}

                {section.table ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                      <thead className="bg-secondary text-foreground">
                        <tr>
                          {section.table.headers.map((header) => (
                            <th
                              key={header}
                              scope="col"
                              className="border-b border-border px-4 py-3 font-medium"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-muted-foreground">
                        {section.table.rows.map((row) => (
                          <tr key={row.join(":")}>
                            {row.map((cell) => (
                              <td key={cell} className="px-4 py-3 align-top">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}


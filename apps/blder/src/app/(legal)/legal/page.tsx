import type { Metadata } from "next";
import Link from "next/link";

import { legalDocuments } from "../_legal-content";

export const metadata: Metadata = {
  title: "Legal - blder.bot",
  description: "Legal, privacy, security, and data handling documents for blder.bot.",
};

export default function LegalIndexPage() {
  return (
    <main id="main-content" className="min-h-screen bg-background text-foreground">
      <div className="container py-10 lg:py-14">
        <section className="max-w-3xl border-b border-border pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Launch legal
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-tight md:text-5xl">
            blder.bot legal documents
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Terms, privacy, data processing, retention, deletion, export, and security
            information for customers using blder.bot and Bob Builder services.
          </p>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {legalDocuments.map((document) => (
            <Link
              className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent"
              href={`/${document.slug}`}
              key={document.slug}
            >
              <h2 className="font-display text-lg font-semibold">{document.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {document.description}
              </p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Updated {document.updatedDate}
              </p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

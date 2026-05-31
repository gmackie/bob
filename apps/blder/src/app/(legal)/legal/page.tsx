import type { Metadata } from "next";
import Link from "next/link";

import { legalDocumentList } from "../legal-docs";

export const metadata: Metadata = {
  title: "Legal - blder.bot",
  description:
    "Legal, privacy, security, and data processing pages for blder.bot.",
};

export default function LegalIndexPage() {
  return (
    <main
      id="main-content"
      className="bg-background text-foreground min-h-screen"
    >
      <div className="container py-10 md:py-14">
        <header className="border-border max-w-3xl border-b pb-8">
          <p className="text-muted-foreground text-sm font-medium">blder.bot</p>
          <h1 className="font-display mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Legal
          </h1>
          <p className="text-muted-foreground mt-4 text-base leading-7">
            Terms, privacy, data processing, security, cookie, deletion, export,
            and subprocessor disclosures for blder.bot.
          </p>
        </header>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {legalDocumentList.map((document) => (
            <Link
              key={document.slug}
              href={`/${document.slug}`}
              className="border-border bg-card hover:border-primary/50 hover:bg-accent rounded-lg border p-5 transition-colors"
            >
              <h2 className="font-display text-xl font-semibold tracking-tight">
                {document.title}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {document.summary}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

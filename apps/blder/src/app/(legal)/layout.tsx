import type { ReactNode } from "react";
import Link from "next/link";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border/70 border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="font-display text-foreground text-lg font-bold tracking-normal"
          >
            blder.bot
          </Link>
          <nav className="text-muted-foreground flex items-center gap-4 text-sm font-medium">
            <Link className="hover:text-foreground" href="/terms">
              Terms
            </Link>
            <Link className="hover:text-foreground" href="/privacy">
              Privacy
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-6 py-12">
        {children}
      </main>
    </div>
  );
}

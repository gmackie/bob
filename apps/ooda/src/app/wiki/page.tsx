"use client";

import { useState } from "react";
import Link from "next/link";
import { useWikiList } from "@/rpc/hooks";

/* ------------------------------------------------------------------ */
/* Wiki listing page                                                   */
/* ------------------------------------------------------------------ */

export default function WikiPage() {
  const [search, setSearch] = useState("");
  const wikiQuery = useWikiList();
  const articles = wikiQuery.data ?? [];

  const filtered = search.trim()
    ? articles.filter((a) =>
        a.title.toLowerCase().includes(search.toLowerCase()),
      )
    : articles;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Wiki</h1>
        <Link
          href="/"
          className="text-sm text-[var(--color-accent)] hover:underline"
        >
          Back to chat
        </Link>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search articles..."
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      {wikiQuery.isLoading && (
        <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
      )}

      {wikiQuery.isError && (
        <p className="text-sm text-red-500">
          Failed to load wiki articles. Is the server running?
        </p>
      )}

      {/* Article grid */}
      {filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((article) => (
            <Link
              key={article.slug}
              href={`/wiki/${encodeURIComponent(article.slug)}`}
              className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 transition-colors hover:border-[var(--color-accent)]/40"
            >
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-accent)]">
                {article.title}
              </h3>

              {/* Tags */}
              {article.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {article.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] text-[var(--color-accent)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Outbound link count */}
              <p className="text-xs text-[var(--color-text-muted)]">
                {article.outboundLinks.length} outbound{" "}
                {article.outboundLinks.length === 1 ? "link" : "links"}
              </p>
            </Link>
          ))}
        </div>
      )}

      {!wikiQuery.isLoading && filtered.length === 0 && articles.length > 0 && (
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          No articles match &ldquo;{search}&rdquo;
        </p>
      )}

      {!wikiQuery.isLoading && articles.length === 0 && (
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          No wiki articles yet. Synthesize one from a thread conversation.
        </p>
      )}
    </div>
  );
}

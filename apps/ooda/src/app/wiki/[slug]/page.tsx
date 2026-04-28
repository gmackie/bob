"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWikiList, useCreateThread } from "@/rpc/hooks";

/* ------------------------------------------------------------------ */
/* Wiki article detail page                                            */
/* ------------------------------------------------------------------ */

export default function WikiArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const wikiQuery = useWikiList();
  const createThread = useCreateThread();

  const articles = wikiQuery.data ?? [];
  const article = articles.find(
    (a) => a.slug === decodeURIComponent(slug),
  );

  // Resolve outbound links to articles that exist in the wiki
  const resolvedLinks = article
    ? article.outboundLinks.map((link) => {
        const target = articles.find(
          (a) => a.slug === link || a.title === link,
        );
        return { label: link, slug: target?.slug ?? null };
      })
    : [];

  const handleExploreFurther = () => {
    if (!article) return;
    createThread.mutate(
      { title: `Exploring: ${article.title}`, tags: ["wiki-explore"] },
      {
        onSuccess: () => {
          router.push("/");
        },
      },
    );
  };

  if (wikiQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          Article not found: {decodeURIComponent(slug)}
        </p>
        <Link
          href="/wiki"
          className="text-sm text-[var(--color-accent)] hover:underline"
        >
          Back to wiki
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Link href="/wiki" className="hover:text-[var(--color-accent)]">
          Wiki
        </Link>
        <span>/</span>
        <span className="text-[var(--color-text)]">{article.title}</span>
      </div>

      {/* Title */}
      <h1 className="mb-4 text-2xl font-bold text-[var(--color-text)]">
        {article.title}
      </h1>

      {/* Tags */}
      {article.tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-1 text-xs text-[var(--color-accent)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Metadata card */}
      <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Article Info
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium text-[var(--color-text-muted)]">
              Slug:
            </dt>
            <dd className="text-[var(--color-text)]">{article.slug}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-[var(--color-text-muted)]">
              Outbound links:
            </dt>
            <dd className="text-[var(--color-text)]">
              {article.outboundLinks.length}
            </dd>
          </div>
        </dl>
      </div>

      {/* Outbound wikilinks */}
      {resolvedLinks.length > 0 && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Related Articles
          </h2>
          <div className="flex flex-wrap gap-2">
            {resolvedLinks.map(({ label, slug: targetSlug }) =>
              targetSlug ? (
                <Link
                  key={label}
                  href={`/wiki/${encodeURIComponent(targetSlug)}`}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40"
                >
                  {label}
                </Link>
              ) : (
                <span
                  key={label}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm text-[var(--color-text-muted)]"
                  title="Article not yet created"
                >
                  {label}
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {/* Explore Further */}
      <button
        onClick={handleExploreFurther}
        disabled={createThread.isPending}
        className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-bg)] transition-opacity disabled:opacity-50"
      >
        {createThread.isPending
          ? "Creating thread..."
          : `Explore Further: ${article.title}`}
      </button>
    </div>
  );
}

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { appRouter, createTRPCContext } from "@bob/api";

import { auth, getSession } from "~/auth/server";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { PrTimeline } from "./_components/pr-timeline";
import { RepositoryHeader } from "./_components/repository-header";

interface RepositoryPageProps {
  params: Promise<{ repositoryId: string }>;
}

export default async function RepositoryPage({ params }: RepositoryPageProps) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  const { repositoryId } = await params;

  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");
  const ctx = await createTRPCContext({
    headers: heads,
    auth,
  });
  const caller = appRouter.createCaller(ctx);

  const [repository, pullRequests] = await Promise.all([
    caller.repository.byId({ id: repositoryId }).catch(() => null),
    caller.pullRequest
      .listByRepository({
        repositoryId,
        includeCommits: true,
        limit: 20,
      })
      .catch(() => []),
  ]);

  if (!repository) {
    notFound();
  }

  prefetch(
    trpc.pullRequest.listByRepository.queryOptions({
      repositoryId,
      includeCommits: true,
      limit: 20,
    }),
  );

  return (
    <HydrateClient>
      <main className="container mx-auto max-w-6xl px-4 py-8">
        <RepositoryHeader repository={repository} />

        <div className="mt-8 space-y-8">
          <section>
            <h2 className="mb-4 text-xl font-semibold">Pull Requests</h2>
            {pullRequests.length === 0 ? (
              <p className="text-gray-500">
                No pull requests found. Push a branch and create a PR to get
                started.
              </p>
            ) : (
              <PrTimeline pullRequests={pullRequests} />
            )}
          </section>
        </div>
      </main>
    </HydrateClient>
  );
}

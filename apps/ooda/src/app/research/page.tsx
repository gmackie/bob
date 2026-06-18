import { HydrateClient, prefetch, trpc } from "~/trpc/server";

import { ActiveDives } from "./_components/ActiveDives";
import { GraphStats } from "./_components/GraphStats";
import { StandingInterestsPanel } from "./_components/StandingInterestsPanel";
import { TodayInbox } from "./_components/TodayInbox";

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function ResearchLandingPage() {
  const since = startOfToday();

  // Server-side prefetch so first paint has data. Each child uses the
  // same tRPC hook keys on the client; react-query's dehydrated cache
  // serves the initial render before the hydrated client takes over.
  prefetch(
    trpc.research.inboxVaultWide.queryOptions({
      triage: "pending",
      since,
      limit: 50,
    }),
  );
  prefetch(trpc.research.divesRecent.queryOptions({}));
  prefetch(trpc.research.interestList.queryOptions({}));
  prefetch(trpc.research.graphStats.queryOptions({}));

  return (
    <HydrateClient>
      <div className="min-h-screen bg-[#111113] text-[#E8E4DF]">
        <div className="mx-auto max-w-6xl px-3 py-6 md:px-6 md:py-10">
          <div className="mb-8">
            <h1 className="font-serif text-2xl text-[#D4A04A]">Research</h1>
            <p className="mt-1 text-sm text-[#8A8580]">
              Vault-wide overview of findings, dives, and standing interests.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Today's inbox">
              <TodayInbox since={since.toISOString()} />
            </Panel>
            <Panel title="Active dives">
              <ActiveDives />
            </Panel>
            <Panel title="Standing interests">
              <StandingInterestsPanel />
            </Panel>
            <Panel title="Graph stats">
              <GraphStats />
            </Panel>
          </div>
        </div>
      </div>
    </HydrateClient>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E]">
      <div className="border-b border-[#2A2A2F] px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-[#8A8580]">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

"use client";

import { ColdThreadUpdates } from "./ColdThreadUpdates";
import { InboxList } from "./InboxList";
import { SynergyList } from "./SynergyList";

interface FindingsRailProps {
  threadId: string;
}

export function FindingsRail({ threadId }: FindingsRailProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Section title="Inbox">
        <InboxList threadId={threadId} />
      </Section>
      <Section title="Synergies">
        <SynergyList threadId={threadId} />
      </Section>
      <Section title="Cold-thread updates">
        <ColdThreadUpdates threadId={threadId} />
      </Section>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#5A5855]">
        {title}
      </h3>
      {children}
    </section>
  );
}

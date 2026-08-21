import { Breadcrumbs } from "~/components/layout/breadcrumbs";

import { HermesConsole } from "./hermes-console";

export default function HermesConsolePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Breadcrumbs items={[{ label: "Hermes" }]} className="mb-4" />
      <HermesConsole />
    </main>
  );
}

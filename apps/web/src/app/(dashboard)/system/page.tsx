import React from "react";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";

import { SystemOperations } from "./_components/system-operations";

export default function SystemPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Breadcrumbs items={[{ label: "System" }]} className="mb-4" />
      <SystemOperations />
    </div>
  );
}

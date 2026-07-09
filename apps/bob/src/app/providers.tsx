"use client";

import type { ReactNode } from "react";

import { initBrowserObservability } from "~/lib/observability-browser";

let bootstrapped = false;

function bootstrapObservability() {
  if (!bootstrapped) {
    initBrowserObservability();
    bootstrapped = true;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  bootstrapObservability();
  return <>{children}</>;
}

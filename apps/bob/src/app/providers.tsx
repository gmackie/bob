"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { watchOnlineFavicon } from "~/lib/favicon-state";
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
  // Offline favicon while the browser has no network.
  useEffect(() => watchOnlineFavicon(), []);
  return <>{children}</>;
}

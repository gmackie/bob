"use client";

import { useEffect } from "react";

import { useCurrentUser } from "./current-user-provider";

export interface AuthedOnlyProps {
  readonly children: React.ReactNode;
  /** Rendered while loading and briefly during redirect. Default: minimal "Loading..." div. */
  readonly fallback?: React.ReactNode;
  /** Where to send unauthenticated visitors. Default: "/login". */
  readonly redirectTo?: string;
}

const DEFAULT_FALLBACK = (
  <div role="status" aria-live="polite">
    Loading...
  </div>
);

export function AuthedOnly({
  children,
  fallback = DEFAULT_FALLBACK,
  redirectTo = "/login",
}: AuthedOnlyProps) {
  const { data, isLoading, error } = useCurrentUser();

  useEffect(() => {
    if (isLoading) return;
    if (data && !error) return;
    // Not authenticated — redirect.
    if (typeof window !== "undefined") {
      window.location.assign(redirectTo);
    }
  }, [data, isLoading, error, redirectTo]);

  if (isLoading) return <>{fallback}</>;
  if (!data || error) return <>{fallback}</>;
  return <>{children}</>;
}

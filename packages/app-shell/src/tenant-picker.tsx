"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useRpcClient } from "./rpc-client-provider";

export interface TenantPickerProps {
  /** Optional callback after a tenant is selected (e.g. navigate). */
  readonly onSelect?: (tenantId: string) => void;
}

/**
 * Lists memberships from `client.auth.listMemberships()`. Click → calls
 * `client.auth.resolveTenant({ tenantIdHint })` then invalidates
 * `["currentUser","whoAmI"]` so `useCurrentUser` refetches with the new tenant.
 */
export function TenantPicker({ onSelect }: TenantPickerProps) {
  const client = useRpcClient();
  const qc = useQueryClient();

  const memberships = useQuery({
    queryKey: ["currentUser", "memberships"],
    queryFn: () => client.auth.listMemberships(),
  });

  const resolveTenant = useMutation({
    mutationFn: (tenantId: string) =>
      client.auth.resolveTenant({ tenantIdHint: tenantId }),
    onSuccess: (_data, tenantId) => {
      void qc.invalidateQueries({ queryKey: ["currentUser", "whoAmI"] });
      onSelect?.(tenantId);
    },
  });

  if (memberships.isLoading) {
    return <div role="status">Loading tenants…</div>;
  }
  if (memberships.error) {
    return (
      <div role="alert">
        Failed to load tenants: {(memberships.error as Error).message}
      </div>
    );
  }
  const list = (memberships.data ?? []) as Array<{
    tenantId: string;
    role: string;
  }>;
  if (list.length === 0) {
    return <div>No tenants available.</div>;
  }

  return (
    <ul aria-label="Select a tenant">
      {list.map((m) => (
        <li key={m.tenantId}>
          <button
            type="button"
            onClick={() => resolveTenant.mutate(m.tenantId)}
            disabled={resolveTenant.isPending}
          >
            {m.tenantId} ({m.role})
          </button>
        </li>
      ))}
    </ul>
  );
}

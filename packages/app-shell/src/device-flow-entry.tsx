"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { useCurrentUser } from "./current-user-provider";
import { useRpcClient } from "./rpc-client-provider";

export interface DeviceFlowEntryProps {
  /** Called after the user-code is successfully approved. */
  readonly onSuccess?: () => void;
}

/**
 * User-code paste + submit. Calls `client.auth.approveDeviceCode({userCode,
 * tenantId})` where `tenantId` comes from the active session via
 * `useCurrentUser()`. Calls `onSuccess` on success.
 */
export function DeviceFlowEntry({ onSuccess }: DeviceFlowEntryProps) {
  const client = useRpcClient();
  const currentUser = useCurrentUser();
  const [userCode, setUserCode] = useState("");

  const approve = useMutation({
    mutationFn: ({ code, tenantId }: { code: string; tenantId: string }) =>
      client.auth.approveDeviceCode({ userCode: code, tenantId }),
    onSuccess: () => {
      onSuccess?.();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = currentUser.data as
      | { tenantId: string }
      | undefined;
    if (!data) return;
    approve.mutate({ code: userCode, tenantId: data.tenantId });
  };

  const disabled = approve.isPending || !currentUser.data;

  return (
    <form onSubmit={handleSubmit} aria-label="Device flow approval">
      <label>
        User code
        <input
          type="text"
          name="userCode"
          required
          value={userCode}
          onChange={(e) => setUserCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
        />
      </label>
      <button type="submit" disabled={disabled}>
        {approve.isPending ? "Approving…" : "Approve"}
      </button>
      {approve.error && (
        <div role="alert">{(approve.error as Error).message}</div>
      )}
    </form>
  );
}

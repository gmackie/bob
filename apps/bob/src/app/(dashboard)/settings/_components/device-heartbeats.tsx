"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface DeviceHeartbeat {
  apiKeyId: string;
  deviceName: string;
  state: string;
  message: string | null;
  wifi: string | null;
  batteryPercent: number | null;
  lastSeenAt: string;
  online: boolean;
  selectedSessionId: string | null;
  selectedSession: SessionOption | null;
}

interface SessionOption {
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string;
}

interface DeviceHeartbeatResponse {
  devices: DeviceHeartbeat[];
  sessions: SessionOption[];
}

export function DeviceHeartbeatsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["device-heartbeats"],
    queryFn: async (): Promise<DeviceHeartbeatResponse> => {
      const response = await fetch("/api/v1/device/heartbeat");
      if (!response.ok) {
        throw new Error("Failed to load devices");
      }
      return (await response.json()) as DeviceHeartbeatResponse;
    },
    refetchInterval: 10_000,
  });

  const assignSession = useMutation({
    mutationFn: async ({
      apiKeyId,
      selectedSessionId,
    }: {
      apiKeyId: string;
      selectedSessionId: string | null;
    }) => {
      const response = await fetch("/api/v1/device/heartbeat", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKeyId, selectedSessionId }),
      });
      if (!response.ok) {
        throw new Error("Failed to update device session");
      }
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["device-heartbeats"] });
    },
  });

  if (isLoading) {
    return (
      <section className="rounded-lg border p-6">
        <div className="animate-pulse space-y-4">
          <div className="bg-muted h-12 rounded" />
          <div className="bg-muted h-12 rounded" />
        </div>
      </section>
    );
  }

  const devices = data?.devices ?? [];
  const sessions = data?.sessions ?? [];

  return (
    <section className="rounded-lg border p-6">
      {devices.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No handheld devices have checked in yet.
        </p>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={device.apiKeyId}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{device.deviceName}</p>
                  <span
                    className={
                      device.online
                        ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
                    }
                  >
                    {device.online ? "Online" : "Offline"}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>{device.state}</span>
                  {device.wifi && <span>{device.wifi}</span>}
                  {device.batteryPercent !== null && (
                    <span>{device.batteryPercent}% battery</span>
                  )}
                </div>
                {device.message && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {device.message}
                  </p>
                )}
                <div className="mt-3 max-w-xl">
                  <label
                    htmlFor={`device-session-${device.apiKeyId}`}
                    className="text-muted-foreground mb-1 block text-xs font-medium uppercase"
                  >
                    Session
                  </label>
                  <select
                    id={`device-session-${device.apiKeyId}`}
                    value={device.selectedSessionId ?? ""}
                    disabled={assignSession.isPending || sessions.length === 0}
                    onChange={(event) =>
                      assignSession.mutate({
                        apiKeyId: device.apiKeyId,
                        selectedSessionId: event.target.value || null,
                      })
                    }
                    className="border-input bg-background ring-offset-background focus:ring-ring h-9 w-full rounded-md border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {sessions.length === 0
                        ? "No existing sessions found"
                        : "No session selected"}
                    </option>
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title} - {session.subtitle}
                      </option>
                    ))}
                  </select>
                  {device.selectedSession && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Selected: {device.selectedSession.title}
                    </p>
                  )}
                  {assignSession.isError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      Could not update selected session.
                    </p>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground shrink-0 text-xs">
                Last seen {new Date(device.lastSeenAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

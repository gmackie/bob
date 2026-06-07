"use client";

import { useQuery } from "@tanstack/react-query";

interface DeviceHeartbeat {
  apiKeyId: string;
  deviceName: string;
  state: string;
  message: string | null;
  wifi: string | null;
  batteryPercent: number | null;
  lastSeenAt: string;
  online: boolean;
}

export function DeviceHeartbeatsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["device-heartbeats"],
    queryFn: async (): Promise<{ devices: DeviceHeartbeat[] }> => {
      const response = await fetch("/api/v1/device/heartbeat");
      if (!response.ok) {
        throw new Error("Failed to load devices");
      }
      return (await response.json()) as { devices: DeviceHeartbeat[] };
    },
    refetchInterval: 10_000,
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

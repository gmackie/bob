import { useEffect, useRef, type ReactNode } from "react";
import * as Notifications from "expo-notifications";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "~/utils/api";

export function NotificationProvider({ children }: { children: ReactNode }) {
  const notifiedCheckIns = useRef(new Set<string>());

  const { data: explorations } = useQuery({
    queryKey: ["explorations"],
    queryFn: rpc.exploration.list,
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!explorations) return;

    for (const exp of explorations) {
      if (
        exp.status === "awaiting_input" &&
        exp.lastCheckIn &&
        !notifiedCheckIns.current.has(exp.lastCheckIn.id)
      ) {
        notifiedCheckIns.current.add(exp.lastCheckIn.id);

        void Notifications.scheduleNotificationAsync({
          content: {
            title: "Agent check-in",
            body: `Exploration "${exp.topic}": ${exp.lastCheckIn.summary}`,
            data: { threadId: exp.threadId, explorationId: exp.id },
          },
          trigger: null, // immediate
        });
      }
    }
  }, [explorations]);

  return <>{children}</>;
}

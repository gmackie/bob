"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import PusherClient from "pusher-js";
import type { Channel } from "pusher-js";

let pusherClient: PusherClient | null = null;

export function getPusherClient(): PusherClient {
  if (pusherClient) return pusherClient;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY ?? "";
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "us2";

  pusherClient = new PusherClient(key, {
    cluster,
  });

  return pusherClient;
}

export function useChannel(channelName: string): Channel | null {
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    const pusher = getPusherClient();
    const ch = pusher.subscribe(channelName);
    setChannel(ch);

    return () => {
      pusher.unsubscribe(channelName);
    };
  }, [channelName]);

  return channel;
}

export function useEvent<T = unknown>(
  channel: Channel | null,
  eventName: string,
  callback: (data: T) => void
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!channel) return;

    const handler = (data: T) => {
      callbackRef.current(data);
    };

    channel.bind(eventName, handler);
    return () => {
      channel.unbind(eventName, handler);
    };
  }, [channel, eventName]);
}

export function useRealtimeData<T>(
  channelName: string,
  eventName: string,
  initialData: T
): T {
  const [data, setData] = useState<T>(initialData);
  const channel = useChannel(channelName);

  useEvent<T>(channel, eventName, useCallback((newData: T) => {
    setData(newData);
  }, []));

  return data;
}

export function useRealtimeUpdates<T>(
  channelName: string,
  eventName: string,
  onUpdate: (data: T) => void
): void {
  const channel = useChannel(channelName);
  useEvent<T>(channel, eventName, onUpdate);
}

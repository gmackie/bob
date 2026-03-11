import React, { createContext, useContext, useEffect, useState } from "react";
import PostHog from "posthog-react-native";
import { useAuth } from "./auth";
import { trpc } from "./trpc";

type PostHogContextType = {
  posthog: PostHog | null;
};

const PostHogContext = createContext<PostHogContextType>({ posthog: null });

export function usePostHog() {
  return useContext(PostHogContext);
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [posthog, setPostHog] = useState<PostHog | null>(null);
  const { isSignedIn, userId } = useAuth();
  const { data: user } = trpc.user.me.useQuery(undefined, { enabled: isSignedIn });

  useEffect(() => {
    const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
    if (!key) {
      console.warn("PostHog key not configured");
      return;
    }

    const client = new PostHog(key, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      enableSessionReplay: true,
      sessionReplayConfig: {
        maskAllTextInputs: true,
        maskAllImages: false,
      },
    });

    setPostHog(client);

    return () => {
      client.shutdown();
    };
  }, []);

  useEffect(() => {
    if (!posthog) return;

    if (isSignedIn && userId) {
      posthog.identify(userId, {
        email: user?.email ?? null,
        name: user?.name ?? null,
      });
    } else if (!isSignedIn) {
      posthog.reset();
    }
  }, [posthog, isSignedIn, userId, user]);

  return (
    <PostHogContext.Provider value={{ posthog }}>
      {children}
    </PostHogContext.Provider>
  );
}

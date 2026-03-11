import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Badge, Button, Card, Screen } from "~/components/ui";
import { getPlanningHref } from "~/features/planning/navigation";
import { hasSeenOnboarding, setOnboardingComplete } from "~/lib/storage";
import { authClient } from "~/utils/auth";

const ONBOARDING_SLIDES = [
  {
    title: "Capture the issue.\nScope the task.",
    bullets: [
      "Use work items to move from intake into execution",
      "Keep planning, comments, and artifacts in one place",
    ],
  },
  {
    title: "Open the task.\nWork with Bob.",
    bullets: [
      "Jump directly into the task workspace from mobile",
      "Track blocked, review-ready, and verification states",
    ],
  },
  {
    title: "Stay aligned\nfrom anywhere.",
    bullets: [
      "Review notifications, comments, and artifacts on the go",
      "Keep execution moving without the old dashboard sprawl",
    ],
  },
];

function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = useCallback(async () => {
    if (currentSlide < ONBOARDING_SLIDES.length - 1) {
      setCurrentSlide((value) => value + 1);
      return;
    }

    await setOnboardingComplete();
    onComplete();
  }, [currentSlide, onComplete]);

  const handleSkip = useCallback(async () => {
    await setOnboardingComplete();
    onComplete();
  }, [onComplete]);

  const slide = ONBOARDING_SLIDES[currentSlide];

  return (
    <Screen className="justify-between pt-16 pb-10">
      <View className="flex-row justify-end">
        {currentSlide < ONBOARDING_SLIDES.length - 1 ? (
          <Pressable onPress={handleSkip} className="active:opacity-70">
            <Text className="text-muted text-base">Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="flex-1 items-center justify-center px-4">
        <View className="bg-primary/20 mb-8 h-20 w-20 items-center justify-center rounded-2xl">
          <Text className="text-4xl">🏗️</Text>
        </View>

        <Text className="text-foreground mb-6 text-center text-3xl font-semibold tracking-tight">
          {slide?.title}
        </Text>

        <View className="space-y-3">
          {slide?.bullets.map((bullet) => (
            <View key={bullet} className="flex-row items-start">
              <View className="bg-primary mt-2 mr-3 h-1.5 w-1.5 rounded-full" />
              <Text className="text-muted flex-1 text-base">{bullet}</Text>
            </View>
          ))}
        </View>
      </View>

      <View>
        <View className="mb-6 flex-row justify-center space-x-2">
          {ONBOARDING_SLIDES.map((item, index) => (
            <View
              key={item.title}
              className={`h-1.5 rounded-full ${index === currentSlide ? "bg-primary w-6" : "bg-border w-1.5"}`}
            />
          ))}
        </View>

        <Button onPress={handleNext} variant="primary">
          {currentSlide < ONBOARDING_SLIDES.length - 1
            ? "Continue"
            : "Continue to Sign In"}
        </Button>
      </View>
    </Screen>
  );
}

function SignInScreen() {
  const handleSignIn = useCallback(() => {
    authClient.signIn
      .social({
        provider: "github",
        callbackURL: "bob://",
      })
      .catch((error: unknown) => {
        console.error("Sign in error:", error);
      });
  }, []);

  return (
    <Screen className="pt-16 pb-10">
      <View className="flex-1">
        <Text className="text-foreground text-4xl font-semibold tracking-tight">
          Welcome to Bob
        </Text>
        <Text className="text-muted mt-2 text-base leading-6">
          Planning stays primary. Task execution stays one tap away.
        </Text>

        <View className="mt-10 space-y-3">
          <Card>
            <View className="flex-row items-center">
              <View className="bg-accent/10 mr-3 h-10 w-10 items-center justify-center rounded-xl">
                <Text className="text-lg">🧱</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  Workspaces, projects, and work items
                </Text>
                <Text className="text-muted text-sm">
                  One planning model across web and mobile
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View className="flex-row items-center">
              <View className="bg-accent/10 mr-3 h-10 w-10 items-center justify-center rounded-xl">
                <Text className="text-lg">🤖</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  Task-scoped Bob execution
                </Text>
                <Text className="text-muted text-sm">
                  Chat, status, and artifacts focused on one task
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View className="flex-row items-center">
              <View className="bg-accent/10 mr-3 h-10 w-10 items-center justify-center rounded-xl">
                <Text className="text-lg">🔔</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  Single inbox
                </Text>
                <Text className="text-muted text-sm">
                  Review-ready and needs-input updates in one place
                </Text>
              </View>
            </View>
          </Card>
        </View>
      </View>

      <View className="mt-auto">
        <Button onPress={handleSignIn} variant="primary">
          Continue with GitHub
        </Button>
        <Text className="text-muted2 mt-3 text-center text-xs">
          Workspace access uses the same shared Bob identity on web and mobile
        </Text>
      </View>
    </Screen>
  );
}

function SessionBootstrapScreen() {
  return (
    <Screen className="items-center justify-center">
      <View className="items-center">
        <View className="bg-primary/20 mb-4 h-16 w-16 items-center justify-center rounded-2xl">
          <Text className="text-3xl">🏗️</Text>
        </View>
        <Text className="text-foreground text-2xl font-semibold tracking-tight">
          Bob Builder
        </Text>
        <Text className="text-muted mt-1 text-sm">
          Loading planning workspace…
        </Text>
      </View>
    </Screen>
  );
}

export default function Index() {
  const { data: session, isPending } = authClient.useSession();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      setShowOnboarding(!seen);
    });
  }, []);

  if (isPending || showOnboarding === null) {
    return <SessionBootstrapScreen />;
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  if (!session) {
    return <SignInScreen />;
  }

  return <Redirect href={getPlanningHref() as never} />;
}

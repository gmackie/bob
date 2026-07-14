import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button, Screen } from "~/components/ui";
import { getTabletDashboardHref } from "~/features/tablet/navigation";
import { ONBOARDING_SLIDES } from "~/features/planning/onboarding-copy";
import { hasSeenOnboarding, setOnboardingComplete } from "~/lib/storage";
import { authClient } from "~/utils/auth";
import { shouldSkipOnboardingForDevAuth } from "~/utils/dev-auth-bypass";

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
            <Text className="text-base text-muted">Skip</Text>
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
              <Text className="text-muted flex-1 text-base">
                {bullet}
              </Text>
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
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(
    shouldSkipOnboardingForDevAuth() ? false : null,
  );

  useEffect(() => {
    if (shouldSkipOnboardingForDevAuth()) {
      return;
    }

    let cancelled = false;
    void hasSeenOnboarding()
      .then((seen) => {
        if (!cancelled) setShowOnboarding(!seen);
      })
      .catch(() => {
        if (!cancelled) setShowOnboarding(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (isPending || showOnboarding === null) {
    return <SessionBootstrapScreen />;
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  if (!session) {
    return <Redirect href={"/pairing" as never} />;
  }

  return <Redirect href={getTabletDashboardHref() as never} />;
}

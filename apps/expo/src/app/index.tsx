import { useCallback, useEffect, useState } from "react";
import { Dimensions, Pressable, ScrollView, Text, View } from "react-native";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import { hasSeenOnboarding, setOnboardingComplete } from "~/lib/storage";
import { authClient } from "~/utils/auth";

const { width } = Dimensions.get("window");

const ONBOARDING_SLIDES = [
  {
    title: "Run multiple agents.\nStay in control.",
    bullets: [
      "Track every worktree and instance at a glance",
      "See what's running, stalled, or needs attention",
    ],
  },
  {
    title: "Built for real\nGit workflows.",
    bullets: [
      "Review diffs and PR status on the go",
      "Keep your AI sessions organized per branch",
    ],
  },
  {
    title: "Secure sign-in\nwith GitHub.",
    bullets: [
      "Authenticate once with your GitHub account",
      "Your credentials stay safe and encrypted",
    ],
  },
];

function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = useCallback(async () => {
    if (currentSlide < ONBOARDING_SLIDES.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      await setOnboardingComplete();
      onComplete();
    }
  }, [currentSlide, onComplete]);

  const handleSkip = useCallback(async () => {
    await setOnboardingComplete();
    onComplete();
  }, [onComplete]);

  const slide = ONBOARDING_SLIDES[currentSlide];

  return (
    <Screen className="justify-between pt-16 pb-10">
      <View className="flex-row justify-end">
        {currentSlide < ONBOARDING_SLIDES.length - 1 && (
          <Pressable onPress={handleSkip} className="active:opacity-70">
            <Text className="text-muted text-base">Skip</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-1 items-center justify-center px-4">
        <View className="bg-primary/20 mb-8 h-20 w-20 items-center justify-center rounded-2xl">
          <Text className="text-4xl">🤖</Text>
        </View>

        <Text className="text-foreground mb-6 text-center text-3xl font-semibold tracking-tight">
          {slide?.title}
        </Text>

        <View className="space-y-3">
          {slide?.bullets.map((bullet, i) => (
            <View key={i} className="flex-row items-start">
              <View className="bg-primary mt-2 mr-3 h-1.5 w-1.5 rounded-full" />
              <Text className="text-muted flex-1 text-base">{bullet}</Text>
            </View>
          ))}
        </View>
      </View>

      <View>
        <View className="mb-6 flex-row justify-center space-x-2">
          {ONBOARDING_SLIDES.map((_, i) => (
            <View
              key={i}
              className={`h-1.5 rounded-full ${i === currentSlide ? "bg-primary w-6" : "bg-border w-1.5"}`}
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
      .then((res) => {
        console.log("Sign in result:", res);
      })
      .catch((err) => {
        console.error("Sign in error:", err);
      });
  }, []);

  return (
    <Screen className="pt-16 pb-10">
      <View className="flex-1">
        <Text className="text-foreground text-4xl font-semibold tracking-tight">
          Welcome to Bob
        </Text>
        <Text className="text-muted mt-2 text-base leading-6">
          Your AI agent command center for repos and worktrees.
        </Text>

        <View className="mt-10 space-y-3">
          <Card>
            <View className="flex-row items-center">
              <View className="bg-accent/10 mr-3 h-10 w-10 items-center justify-center rounded-xl">
                <Text className="text-lg">📊</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  Multi-instance overview
                </Text>
                <Text className="text-muted text-sm">
                  See all your agents at a glance
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View className="flex-row items-center">
              <View className="bg-accent/10 mr-3 h-10 w-10 items-center justify-center rounded-xl">
                <Text className="text-lg">🌳</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  Worktree-aware sessions
                </Text>
                <Text className="text-muted text-sm">
                  Isolated agents per branch
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View className="flex-row items-center">
              <View className="bg-accent/10 mr-3 h-10 w-10 items-center justify-center rounded-xl">
                <Text className="text-lg">🔀</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  PR & diff visibility
                </Text>
                <Text className="text-muted text-sm">
                  Track changes across branches
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
          We only request basic account access
        </Text>
      </View>
    </Screen>
  );
}

function DashboardScreen({
  session,
}: {
  session: NonNullable<ReturnType<typeof authClient.useSession>["data"]>;
}) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const handleSignOut = useCallback(() => {
    authClient.signOut();
  }, []);

  return (
    <Screen className="pt-8">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <View className="mb-6 flex-row items-center justify-between">
          <View>
            <Text className="text-foreground text-2xl font-semibold tracking-tight">
              {getGreeting()}, {session.user.name?.split(" ")[0] ?? "there"}
            </Text>
            <Text className="text-muted mt-0.5 text-sm">
              {session.user.email}
            </Text>
          </View>
          <Badge variant="success">Connected</Badge>
        </View>

        <View className="mb-6 flex-row space-x-3">
          <Card className="flex-1">
            <Text className="text-foreground text-2xl font-semibold">0</Text>
            <Text className="text-muted2 mt-1 text-xs tracking-widest uppercase">
              Active Agents
            </Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-foreground text-2xl font-semibold">0</Text>
            <Text className="text-muted2 mt-1 text-xs tracking-widest uppercase">
              Worktrees
            </Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-foreground text-2xl font-semibold">0</Text>
            <Text className="text-muted2 mt-1 text-xs tracking-widest uppercase">
              Open PRs
            </Text>
          </Card>
        </View>

        <Text className="text-foreground mb-3 text-lg font-semibold tracking-tight">
          Quick Actions
        </Text>
        <View className="mb-6 space-y-2">
          <Button variant="secondary" onPress={() => {}}>
            Open Worktrees
          </Button>
          <Button variant="secondary" onPress={() => {}}>
            View Running Agents
          </Button>
          <Button variant="secondary" onPress={() => {}}>
            Recent Diffs
          </Button>
        </View>

        <Text className="text-foreground mb-3 text-lg font-semibold tracking-tight">
          Recent Activity
        </Text>
        <Card>
          <View className="items-center py-6">
            <Text className="text-muted2 text-sm">No recent activity</Text>
            <Text className="text-muted mt-1 text-xs">
              Connect a repository to get started
            </Text>
          </View>
        </Card>

        <View className="mt-8 mb-4">
          <Button variant="ghost" onPress={handleSignOut}>
            Sign Out
          </Button>
        </View>
      </ScrollView>
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
    return (
      <Screen className="items-center justify-center">
        <View className="items-center">
          <View className="bg-primary/20 mb-4 h-16 w-16 items-center justify-center rounded-2xl">
            <Text className="text-3xl">🤖</Text>
          </View>
          <Text className="text-foreground text-2xl font-semibold tracking-tight">
            Bob
          </Text>
          <Text className="text-muted mt-1 text-sm">Agent command center</Text>
        </View>
      </Screen>
    );
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  if (!session) {
    return <SignInScreen />;
  }

  return <DashboardScreen session={session} />;
}

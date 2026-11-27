import type { ImageSourcePropType, ScrollViewInstance } from "react-native";
import { useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { ONBOARDING_SLIDES } from "~/features/planning/onboarding-copy";
import { useSystemReducedMotion } from "~/hooks/use-system-reduced-motion";
import { setOnboardingComplete } from "~/lib/storage";

type Slide = (typeof ONBOARDING_SLIDES)[number];
const scenes = {
  plan: {
    image: require("@bob/arcade/art/plan.png"),
    label: "Plan",
    wash: "#253530",
    accent: "#ffd185",
  },
  work: {
    image: require("@bob/arcade/art/work.png"),
    label: "Work",
    wash: "#203637",
    accent: "#9edccc",
  },
  ship: {
    image: require("@bob/arcade/art/ship.png"),
    label: "Follow",
    wash: "#31332c",
    accent: "#f9c18c",
  },
} satisfies Record<
  Slide["scene"],
  { image: ImageSourcePropType; label: string; wash: string; accent: string }
>;

const mono = Platform.select({ ios: "Menlo", default: "monospace" });
const artEnter = FadeInRight.duration(400);
const artExit = FadeOut.duration(125);
const copyEnter = FadeInDown.duration(340);
const markEnter = FadeIn.duration(160);

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [slide, setSlide] = useState<Slide>(ONBOARDING_SLIDES[0]);
  const [saving, setSaving] = useState(false);
  const completing = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const { width, height } = useWindowDimensions();
  const reduced = useSystemReducedMotion();

  const page = ONBOARDING_SLIDES.indexOf(slide);
  const scene = scenes[slide.scene];
  const nextSlide = ONBOARDING_SLIDES[page + 1];
  const last = !nextSlide;
  const artHeight = Math.min(270, (width - 36) * 0.61, height * 0.31);

  function goTo(next: Slide) {
    if (slide === next || completing.current) return;
    scroll.current?.scrollTo({ y: 0, animated: false });
    setSlide(next);
    AccessibilityInfo.announceForAccessibility(
      `Step ${ONBOARDING_SLIDES.indexOf(next) + 1} of ${ONBOARDING_SLIDES.length}. ${next.title.replace("\n", " ")}`,
    );
  }

  async function finish() {
    if (completing.current) return;
    completing.current = true;
    setSaving(true);
    try {
      await setOnboardingComplete();
    } catch {
      completing.current = false;
      setSaving(false);
      Alert.alert("Couldn’t save your progress", "Please try again.");
      return;
    }
    onComplete();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.brand} accessible accessibilityLabel="Bob">
            <View
              style={styles.hat}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.hatDome} />
              <View style={styles.hatRidge} />
              <View style={styles.hatBrim} />
            </View>
            <Text style={styles.wordmark}>Bob</Text>
          </View>
          {!last ? (
            <Pressable
              accessibilityRole="button"
              onPress={finish}
              disabled={saving}
              style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scroll}
          style={styles.scroll}
          contentContainerStyle={styles.contents}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.plate}>
            <View
              style={[
                styles.stage,
                { height: artHeight, backgroundColor: scene.wash },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.grid} pointerEvents="none">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <View
                    key={n}
                    style={[styles.vertical, { left: `${n * 12.5}%` }]}
                  />
                ))}
                {[1, 2, 3, 4].map((n) => (
                  <View
                    key={n}
                    style={[styles.horizontal, { top: `${n * 20}%` }]}
                  />
                ))}
              </View>
              <Animated.View
                key={slide.scene}
                entering={reduced ? undefined : artEnter}
                exiting={reduced ? undefined : artExit}
                style={styles.art}
              >
                <Image
                  source={scene.image}
                  style={styles.image}
                  resizeMode="contain"
                  accessible={false}
                />
              </Animated.View>
            </View>

            <View style={styles.steps}>
              {ONBOARDING_SLIDES.map((step, index) => {
                const active = index === page;
                return (
                  <Pressable
                    key={step.scene}
                    testID={`onboarding-step-${step.scene}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Step ${index + 1} of ${ONBOARDING_SLIDES.length}, ${scenes[step.scene].label}`}
                    onPress={() => goTo(step)}
                    style={({ pressed }) => [
                      styles.step,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.stepMark,
                        {
                          backgroundColor:
                            index <= page ? scene.accent : "#56605a",
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.stepLabel,
                        active && { color: scene.accent },
                      ]}
                    >
                      {scenes[step.scene].label}
                    </Text>
                    {active ? (
                      <Animated.View
                        entering={reduced ? undefined : markEnter}
                        style={[
                          styles.underline,
                          { backgroundColor: scene.accent },
                        ]}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Animated.View
            key={slide.scene}
            entering={reduced ? undefined : copyEnter}
            style={styles.copy}
          >
            <Text accessibilityRole="header" style={styles.title}>
              {slide.title}
            </Text>
            <View style={styles.bullets}>
              {slide.bullets.map((bullet) => (
                <View key={bullet} style={styles.bullet}>
                  <View
                    style={[
                      styles.bulletMark,
                      { backgroundColor: scene.accent },
                    ]}
                  />
                  <Text style={styles.body}>{bullet}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={nextSlide ? () => goTo(nextSlide) : finish}
            accessibilityRole="button"
            accessibilityLabel={last ? "Continue to Sign In" : "Continue"}
            disabled={saving}
            accessibilityState={{ disabled: saving }}
            style={({ pressed }) => [
              styles.next,
              pressed && styles.nextPressed,
            ]}
          >
            <Text style={styles.nextText}>
              {last ? "Continue to Sign In" : "Continue"}
            </Text>
            <Text
              style={styles.arrow}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              →
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#121815" },
  shell: {
    flex: 1,
    width: "100%",
    maxWidth: 580,
    alignSelf: "center",
    paddingHorizontal: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 54,
    paddingVertical: 3,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  wordmark: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -1.2,
    color: "#f5f0e4",
  },
  hat: { height: 24, width: 28 },
  hatDome: {
    position: "absolute",
    left: 4,
    bottom: 5,
    height: 15,
    width: 20,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: "#e7aa47",
  },
  hatRidge: {
    position: "absolute",
    left: 12,
    bottom: 6,
    height: 15,
    width: 4,
    borderRadius: 1,
    backgroundColor: "#ffce77",
  },
  hatBrim: {
    position: "absolute",
    left: 1,
    bottom: 3,
    height: 4,
    width: 26,
    borderRadius: 1,
    backgroundColor: "#f2bb60",
  },
  skip: {
    minHeight: 44,
    minWidth: 54,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  skipText: { color: "#c2c6ba", fontSize: 16, fontWeight: "600" },
  scroll: { flex: 1 },
  contents: { flexGrow: 1, justifyContent: "center", paddingVertical: 16 },
  plate: {
    borderRadius: 20,
    backgroundColor: "#1c2521",
    borderColor: "#39453e",
    borderWidth: 1,
    overflow: "hidden",
  },
  stage: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  grid: { ...StyleSheet.absoluteFill, opacity: 0.28 },
  vertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#779187",
  },
  horizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#779187",
  },
  art: { position: "absolute", left: 8, right: 8, top: 7, bottom: 5 },
  image: { width: "100%", height: "100%" },
  steps: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#4c5a50",
  },
  step: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  stepMark: { width: 5, height: 5, borderRadius: 1 },
  stepLabel: {
    color: "#b0bdb3",
    fontFamily: mono,
    fontSize: 12,
    fontWeight: "600",
  },
  underline: {
    position: "absolute",
    bottom: 0,
    left: "16%",
    right: "16%",
    height: 2,
  },
  copy: { alignSelf: "stretch", paddingTop: 24, gap: 15 },
  title: {
    color: "#faf4e5",
    fontWeight: "800",
    fontSize: 36,
    letterSpacing: -1.65,
  },
  bullets: { alignSelf: "stretch", gap: 9 },
  bullet: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  bulletMark: { width: 8, height: 2, marginTop: 12, borderRadius: 1 },
  body: { flex: 1, color: "#c4ccbf", fontSize: 16, lineHeight: 24 },
  footer: { paddingTop: 10, paddingBottom: 10 },
  next: {
    minHeight: 56,
    borderRadius: 15,
    paddingVertical: 13,
    paddingHorizontal: 19,
    backgroundColor: "#f5ba5b",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  nextText: {
    color: "#211c13",
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  arrow: { color: "#211c13", fontSize: 25, lineHeight: 27, fontWeight: "600" },
  pressed: { opacity: 0.65 },
  nextPressed: { backgroundColor: "#e5a84c" },
});

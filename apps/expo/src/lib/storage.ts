import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDING_KEY = "bob:hasSeenOnboarding";

export async function hasSeenOnboarding(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === "true";
}

export async function setOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, "true");
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_KEY);
}

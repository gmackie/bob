import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export async function successHaptic() {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

export async function errorHaptic() {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

export async function lightHaptic() {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export async function mediumHaptic() {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

export async function selectionHaptic() {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await Haptics.selectionAsync();
  }
}

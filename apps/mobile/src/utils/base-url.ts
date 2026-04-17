import Constants from "expo-constants";

export function getBaseUrl(): string {
  const extra = Constants.expoConfig?.extra;
  if (extra?.API_URL) return extra.API_URL as string;
  // Default for local dev
  return "http://localhost:3000";
}

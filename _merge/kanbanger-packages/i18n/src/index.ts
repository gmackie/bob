import type en from "../locales/en.json";

// Type for all messages
export type Messages = typeof en;

// Supported locales
export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

// Default locale (fallback)
export const defaultLocale: Locale = "en";

// Check if a locale is supported
export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

// Get the best matching locale
export function resolveLocale(requested: string | null | undefined): Locale {
  if (!requested) return defaultLocale;
  
  // Exact match
  if (isValidLocale(requested)) return requested;
  
  // Language code match (e.g., "en-US" -> "en")
  const languageCode = requested.split("-")[0];
  if (languageCode && isValidLocale(languageCode)) return languageCode;
  
  return defaultLocale;
}

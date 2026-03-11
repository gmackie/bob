import React, { type ReactNode } from "react";
import { IntlProvider as UseIntlProvider } from "use-intl";
import { defaultLocale, resolveLocale, type Locale } from "./index";
import en from "../locales/en.json";

// Message loader with fallback
function loadMessages(locale: Locale): typeof en {
  // For now, only English is bundled
  // Add more locales here as they're added to locales/
  switch (locale) {
    case "en":
    default:
      return en;
  }
}

// Detect device locale (requires expo-localization as peer dep)
export function getDeviceLocale(): Locale {
  try {
    // Dynamic import to avoid requiring expo-localization when not available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getLocales } = require("expo-localization");
    const deviceLocale = getLocales()[0]?.languageCode;
    return resolveLocale(deviceLocale);
  } catch {
    return defaultLocale;
  }
}

interface I18nProviderProps {
  children: ReactNode;
  locale?: Locale;
}

export function I18nProvider({ children, locale }: I18nProviderProps) {
  const resolvedLocale = locale ?? getDeviceLocale();
  const messages = loadMessages(resolvedLocale);

  return (
    <UseIntlProvider locale={resolvedLocale} messages={messages}>
      {children}
    </UseIntlProvider>
  );
}

// Re-export use-intl hooks
export {
  useTranslations,
  useLocale,
  useMessages,
  useNow,
  useTimeZone,
  useFormatter,
} from "use-intl";

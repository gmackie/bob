import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./index";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = resolveLocale(requested);

  let messages;
  try {
    messages = (await import(`../locales/${locale}.json`)).default;
  } catch {
    // Fallback to English if locale file doesn't exist
    messages = (await import("../locales/en.json")).default;
  }

  return {
    locale,
    messages,
  };
});

// Re-export next-intl utilities for convenience
export {
  useTranslations,
  useLocale,
  useMessages,
  useNow,
  useTimeZone,
  useFormatter,
  NextIntlClientProvider,
} from "next-intl";

export { getTranslations, getLocale, getMessages } from "next-intl/server";

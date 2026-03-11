import { resolveLocale } from "@linear-clone/i18n";
import enMessages from "@linear-clone/i18n/messages/en";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveLocale(await requestLocale);

  return {
    locale,
    messages: enMessages,
  };
});

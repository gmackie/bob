/** Match the installed app variant when Better Auth constructs its native callback. */
export function getMobileAuthScheme(
  scheme: string | string[] | undefined,
): string {
  if (scheme === undefined) return "bob";
  const candidates = Array.isArray(scheme) ? scheme : [scheme];
  const configured = candidates.find((value) =>
    /^[a-z][a-z0-9+.-]*$/i.test(value),
  );
  if (!configured)
    throw new Error("The Expo app must declare a valid native URL scheme");
  return configured;
}

export function getMobileOAuthCallbackPath(): string {
  return "/";
}

export async function dismissExistingAuthBrowser(
  dismissBrowser: () => Promise<unknown>,
): Promise<void> {
  try {
    await dismissBrowser();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no web browser to dismiss")) return;
    throw error;
  }
}

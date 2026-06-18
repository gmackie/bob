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

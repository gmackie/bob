export function getMobileAuthHeaders(
  credential: string | undefined,
  devAuthBypassEnabled: boolean,
): Record<string, string> {
  if (!credential) return {};

  return devAuthBypassEnabled
    ? { Authorization: `Bearer ${credential}` }
    : { Cookie: credential };
}

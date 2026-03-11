/**
 * Microsoft Entra ID (Azure AD) OAuth provider
 * Primary authentication for @gmacko.com domain
 */

export interface EntraConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string; // Use tenant ID for single-tenant app, or 'common' for multi-tenant
  redirectUri: string;
}

export interface EntraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  refresh_token?: string;
}

export interface EntraUserInfo {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  mail: string;
  userPrincipalName: string;
  jobTitle?: string;
  officeLocation?: string;
}

const ENTRA_AUTHORITY = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}`;

/**
 * Generate the OAuth authorization URL for Entra ID
 */
export function getEntraAuthUrl(config: EntraConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
    // Force domain hint for gmacko.com
    domain_hint: "gmacko.com",
  });

  return `${ENTRA_AUTHORITY(config.tenantId)}/oauth2/v2.0/authorize?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeEntraCode(
  config: EntraConfig,
  code: string
): Promise<EntraTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    scope: "openid profile email User.Read",
  });

  const response = await fetch(
    `${ENTRA_AUTHORITY(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Entra token exchange failed: ${error}`);
  }

  return response.json() as Promise<EntraTokenResponse>;
}

/**
 * Get user info from Microsoft Graph API
 */
export async function getEntraUserInfo(
  accessToken: string
): Promise<EntraUserInfo> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Entra user info: ${error}`);
  }

  return response.json() as Promise<EntraUserInfo>;
}

/**
 * Validate that the email domain is allowed (gmacko.com)
 */
export function validateEntraDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === "gmacko.com";
}

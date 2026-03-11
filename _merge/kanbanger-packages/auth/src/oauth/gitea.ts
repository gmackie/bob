/**
 * Gitea OAuth provider
 * Used for webhook setup and linking Gitea accounts
 */

export interface GiteaConfig {
  baseUrl: string; // e.g., https://git.gmac.io
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GiteaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

export interface GiteaUserInfo {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
  created: string;
}

/**
 * Generate the OAuth authorization URL for Gitea
 */
export function getGiteaAuthUrl(config: GiteaConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
    scope: "read:user user:email repo",
  });

  return `${config.baseUrl}/login/oauth/authorize?${params}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeGiteaCode(
  config: GiteaConfig,
  code: string
): Promise<GiteaTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(`${config.baseUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gitea token exchange failed: ${error}`);
  }

  return response.json() as Promise<GiteaTokenResponse>;
}

/**
 * Get user info from Gitea API
 */
export async function getGiteaUserInfo(
  config: GiteaConfig,
  accessToken: string
): Promise<GiteaUserInfo> {
  const response = await fetch(`${config.baseUrl}/api/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Gitea user info: ${error}`);
  }

  return response.json() as Promise<GiteaUserInfo>;
}

/**
 * Refresh an access token
 */
export async function refreshGiteaToken(
  config: GiteaConfig,
  refreshToken: string
): Promise<GiteaTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(`${config.baseUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gitea token refresh failed: ${error}`);
  }

  return response.json() as Promise<GiteaTokenResponse>;
}

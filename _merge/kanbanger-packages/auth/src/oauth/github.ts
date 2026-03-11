/**
 * GitHub OAuth provider
 * Used for webhook setup and linking GitHub accounts
 */

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

export interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

/**
 * Generate the OAuth authorization URL for GitHub
 */
export function getGitHubAuthUrl(config: GitHubConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "user:email repo read:org",
    state,
  });

  return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeGitHubCode(
  config: GitHubConfig,
  code: string
): Promise<GitHubTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub token exchange failed: ${error}`);
  }

  const data = await response.json() as GitHubTokenResponse;
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }

  return data;
}

/**
 * Get user info from GitHub API
 */
export async function getGitHubUserInfo(
  accessToken: string
): Promise<GitHubUserInfo> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get GitHub user info: ${error}`);
  }

  return response.json() as Promise<GitHubUserInfo>;
}

/**
 * Get user emails from GitHub API
 */
export async function getGitHubUserEmails(
  accessToken: string
): Promise<GitHubEmail[]> {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get GitHub emails: ${error}`);
  }

  return response.json() as Promise<GitHubEmail[]>;
}

/**
 * Get the primary verified email from GitHub
 */
export async function getGitHubPrimaryEmail(
  accessToken: string
): Promise<string | null> {
  const emails = await getGitHubUserEmails(accessToken);
  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email ?? null;
}

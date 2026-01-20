import { Linking } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";

export type DeepLinkRoute =
  | { type: "session"; sessionId: string }
  | { type: "repo"; repositoryId: string }
  | { type: "pr"; url: string }
  | {
      type: "pr_details";
      provider: string;
      owner: string;
      repo: string;
      number: number;
    }
  | { type: "task"; taskId: string }
  | { type: "auth_callback"; params: Record<string, string> }
  | { type: "unknown"; path: string };

const SCHEME = "bob";

export function parseDeepLink(url: string): DeepLinkRoute | null {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== `${SCHEME}:`) {
      return null;
    }

    const pathParts = parsed.pathname.replace(/^\/+/, "").split("/");
    const [routeType, ...rest] = pathParts;

    switch (routeType) {
      case "session":
        if (rest[0]) {
          return { type: "session", sessionId: rest[0] };
        }
        break;

      case "repo":
        if (rest[0]) {
          return { type: "repo", repositoryId: rest[0] };
        }
        break;

      case "pr":
        if (rest.length >= 4) {
          const [provider, owner, repo, numberStr] = rest;
          const number = parseInt(numberStr!, 10);
          if (!isNaN(number)) {
            return {
              type: "pr_details",
              provider: provider!,
              owner: owner!,
              repo: repo!,
              number,
            };
          }
        } else if (rest[0]) {
          const decodedUrl = decodeURIComponent(rest.join("/"));
          return { type: "pr", url: decodedUrl };
        }
        break;

      case "task":
        if (rest[0]) {
          return { type: "task", taskId: rest[0] };
        }
        break;

      case "auth":
        if (rest[0] === "callback") {
          const params: Record<string, string> = {};
          parsed.searchParams.forEach((value, key) => {
            params[key] = value;
          });
          return { type: "auth_callback", params };
        }
        break;
    }

    return { type: "unknown", path: parsed.pathname };
  } catch {
    return null;
  }
}

export function navigateToDeepLink(route: DeepLinkRoute): void {
  switch (route.type) {
    case "session":
      router.push(`/session/${route.sessionId}`);
      break;

    case "repo":
      router.push(`/repo/${route.repositoryId}`);
      break;

    case "pr":
      WebBrowser.openBrowserAsync(route.url);
      break;

    case "pr_details":
      router.push(
        `/pr/${route.provider}/${route.owner}/${route.repo}/${route.number}`,
      );
      break;

    case "task":
      router.push(`/task/${route.taskId}`);
      break;

    case "auth_callback":
      break;

    case "unknown":
      console.warn(`Unknown deep link route: ${route.path}`);
      break;
  }
}

export function handleDeepLinkUrl(url: string | null): void {
  if (!url) return;

  const route = parseDeepLink(url);
  if (route) {
    navigateToDeepLink(route);
  }
}

export function buildSessionDeepLink(sessionId: string): string {
  return `${SCHEME}://session/${sessionId}`;
}

export function buildRepoDeepLink(repositoryId: string): string {
  return `${SCHEME}://repo/${repositoryId}`;
}

export function buildPRDeepLink(
  provider: string,
  owner: string,
  repo: string,
  number: number,
): string {
  return `${SCHEME}://pr/${provider}/${owner}/${repo}/${number}`;
}

export function buildPRDeepLinkFromUrl(prUrl: string): string {
  return `${SCHEME}://pr/${encodeURIComponent(prUrl)}`;
}

export function buildTaskDeepLink(taskId: string): string {
  return `${SCHEME}://task/${taskId}`;
}

export function buildAuthCallbackLink(params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
  return `${SCHEME}://auth/callback?${searchParams.toString()}`;
}

export async function getInitialDeepLink(): Promise<DeepLinkRoute | null> {
  const initialUrl = await Linking.getInitialURL();
  if (initialUrl) {
    return parseDeepLink(initialUrl);
  }
  return null;
}

export function subscribeToDeepLinks(
  callback: (route: DeepLinkRoute) => void,
): () => void {
  const subscription = Linking.addEventListener("url", ({ url }) => {
    const route = parseDeepLink(url);
    if (route) {
      callback(route);
    }
  });

  return () => subscription.remove();
}

export const linkingConfig = {
  prefixes: [`${SCHEME}://`],
  config: {
    screens: {
      index: "",
      "session/[id]": "session/:id",
      "repo/[id]": "repo/:id",
      "pr/[provider]/[owner]/[repo]/[number]":
        "pr/:provider/:owner/:repo/:number",
      "task/[id]": "task/:id",
      settings: "settings",
    },
  },
};

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
const DEEP_LINK_DEBUG =
  __DEV__ ||
  process.env.EXPO_PUBLIC_DEEP_LINK_DEBUG === "1" ||
  process.env.EXPO_PUBLIC_CESP_DEBUG === "1";

function logDeepLink(message: string, payload?: Record<string, unknown>): void {
  if (!DEEP_LINK_DEBUG) return;
  if (payload) {
    console.info(`[deep-link] ${message}`, payload);
    return;
  }
  console.info(`[deep-link] ${message}`);
}

function pushKnownRoute(path: string): void {
  // Expo router's generated route union currently does not include these
  // deep-link targets, so we cast at the boundary here.
  router.push(path as never);
}

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
  logDeepLink("navigating deep link route", { routeType: route.type });
  switch (route.type) {
    case "session":
      pushKnownRoute(`/session/${route.sessionId}`);
      break;

    case "repo":
      pushKnownRoute(`/repo/${route.repositoryId}`);
      break;

    case "pr":
      WebBrowser.openBrowserAsync(route.url);
      break;

    case "pr_details":
      pushKnownRoute(
        `/pr/${route.provider}/${route.owner}/${route.repo}/${route.number}`,
      );
      break;

    case "task":
      pushKnownRoute(`/task/${route.taskId}`);
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

  logDeepLink("received deep link url", { url });
  const route = parseDeepLink(url);
  if (route) {
    logDeepLink("parsed deep link route", { routeType: route.type });
    navigateToDeepLink(route);
  } else {
    logDeepLink("failed to parse deep link url", { url });
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
  logDeepLink("resolved initial deep link url", {
    hasInitialUrl: Boolean(initialUrl),
  });
  if (initialUrl) {
    return parseDeepLink(initialUrl);
  }
  return null;
}

export function subscribeToDeepLinks(
  callback: (route: DeepLinkRoute) => void,
): () => void {
  const subscription = Linking.addEventListener("url", ({ url }) => {
    logDeepLink("subscription received deep link url", { url });
    const route = parseDeepLink(url);
    if (route) {
      logDeepLink("subscription parsed deep link route", {
        routeType: route.type,
      });
      callback(route);
    } else {
      logDeepLink("subscription could not parse deep link url", { url });
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

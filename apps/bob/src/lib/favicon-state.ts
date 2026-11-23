import { useEffect } from "react";

/**
 * Tab favicon states. Each non-default state has a hand-drawn variant in
 * public/favicon-states/; "default" is the regular /favicon.svg.
 */
export type FaviconState =
  | "default"
  | "working"
  | "success"
  | "attention"
  | "error"
  | "offline";

const SVG_ICON_SELECTOR = 'link[rel~="icon"][type="image/svg+xml"]';

export function faviconHref(state: FaviconState): string {
  return state === "default"
    ? "/favicon.svg"
    : `/favicon-states/favicon-${state}.svg`;
}

/** Point the SVG favicon at the given state's art (creates the link if absent). */
export function setFaviconState(state: FaviconState): void {
  if (typeof document === "undefined") return;
  let link = document.head.querySelector<HTMLLinkElement>(SVG_ICON_SELECTOR);
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  const href = faviconHref(state);
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

/** Show `state` while mounted (and while it changes); reset to default on unmount. */
export function useFaviconState(state: FaviconState): void {
  useEffect(() => {
    setFaviconState(state);
  }, [state]);
  useEffect(() => () => setFaviconState("default"), []);
}

/**
 * Switch to the offline favicon while the browser reports no network, and back
 * to default when it reconnects. Returns a cleanup function.
 */
export function watchOnlineFavicon(): () => void {
  if (typeof window === "undefined") return () => {};
  const sync = () => setFaviconState(navigator.onLine ? "default" : "offline");
  sync();
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  return () => {
    window.removeEventListener("online", sync);
    window.removeEventListener("offline", sync);
  };
}

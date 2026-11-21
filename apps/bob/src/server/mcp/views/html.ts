import { STYLES } from "./render";
import { SDLC_STYLES } from "./sdlc.render";

export const VIEWS = {
  workspace: { uri: "ui://bob/workspace.html", entry: "workspace.client.ts", title: "Bob workspace" },
  planning: { uri: "ui://bob/planning-review.html", entry: "planning.client.ts", title: "Bob planning review" },
  sdlc: { uri: "ui://bob/sdlc.html", entry: "sdlc.client.ts", title: "Bob SDLC" },
} as const;

export type ViewName = keyof typeof VIEWS;

// Hosts snapshot the resource once and serve it into a sandboxed iframe, so a
// view is one document with its bundled script inline.
export function viewDocument(name: ViewName, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${VIEWS[name].title}</title>
<style>${STYLES}${SDLC_STYLES}</style>
</head>
<body>
<main id="app" aria-live="polite">Loading…</main>
<script type="module">${script.replaceAll("</script", "<\\/script")}</script>
</body>
</html>`;
}

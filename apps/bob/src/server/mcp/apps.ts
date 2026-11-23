// The MCP Apps views this server serves as `ui://` resources. A view reaches
// Bob only through the host's tools/call bridge, under the connection's OAuth
// grant; the SDLC view also opens the edge socket, so it declares that origin.
import { VIEW_HTML } from "./views/generated";
import { VIEWS, type ViewName } from "./views/html";

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const VIEW_URIS = Object.fromEntries(
  Object.entries(VIEWS).map(([name, view]) => [name, view.uri]),
) as { readonly [K in ViewName]: (typeof VIEWS)[K]["uri"] };

export function makeApps(origin: string) {
  const edge = new URL(origin);
  edge.protocol = edge.protocol === "https:" ? "wss:" : "ws:";
  const meta = (name: ViewName) => ({
    ui: {
      prefersBorder: true,
      ...(name === "sdlc" ? { csp: { connectDomains: [edge.origin] } } : {}),
    },
  });
  const names = Object.keys(VIEWS) as ViewName[];
  return {
    list: () =>
      names.map((name) => ({
        uri: VIEWS[name].uri,
        name,
        title: VIEWS[name].title,
        mimeType: MCP_APP_MIME_TYPE,
        _meta: meta(name),
      })),
    /** `undefined` for a URI this server does not serve. */
    read(uri: string) {
      const name = names.find((candidate) => VIEWS[candidate].uri === uri);
      return name === undefined
        ? undefined
        : { uri, mimeType: MCP_APP_MIME_TYPE, text: VIEW_HTML[name], _meta: meta(name) };
    },
  };
}

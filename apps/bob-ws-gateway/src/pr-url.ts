/** Parse a Forgejo/Gitea/GitHub PR url into its parts. Returns null if it
 *  doesn't match the `.../<owner>/<repo>/pulls|pull/<n>` shape. Kept in its own
 *  module so it's unit-testable without importing relay.ts's DB client. */
export function parsePrUrl(url: string): {
  host: string;
  owner: string;
  repo: string;
  number: number;
  provider: "github" | "gitea";
} | null {
  const m = url.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(?:pulls|pull)\/(\d+)/,
  );
  if (!m) return null;
  const [, host, owner, repo, numStr] = m;
  return {
    host: host!,
    owner: owner!,
    repo: repo!,
    number: Number(numStr),
    provider: host === "github.com" ? "github" : "gitea",
  };
}

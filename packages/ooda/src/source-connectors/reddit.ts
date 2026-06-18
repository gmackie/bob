import type { ConnectorResult } from "./base-connector";

export interface CapabilityDefinition {
  id: string;
  name: string;
  kind: string;
  provider: string;
  version: string;
  description: string;
  tags: string[];
  trustLevel: string;
  executionScope: string;
  defaultAccessMode: string;
  authRequirements: string[];
  supportsProvenance: boolean;
}

export const REDDIT_CAPABILITY: CapabilityDefinition = {
  id: "reddit",
  name: "Reddit",
  kind: "source_connector",
  provider: "reddit",
  version: "1.0.0",
  description: "Reddit community search and discussion connector",
  tags: ["community", "discussion", "social"],
  trustLevel: "reviewed",
  executionScope: "remote_ok",
  defaultAccessMode: "read_only",
  authRequirements: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  supportsProvenance: true,
};

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  permalink: string;
  subreddit: string;
  score: number;
  created_utc: number;
  url: string;
}

interface RedditListingResponse {
  data: {
    children: Array<{ data: RedditPost }>;
  };
}

export function normalizeRedditResponse(
  raw: RedditListingResponse,
): ConnectorResult[] {
  return raw.data.children.map(({ data: post }) => ({
    id: `reddit_${post.id}`,
    title: post.title,
    content: post.selftext,
    url: `https://reddit.com${post.permalink}`,
    source: "reddit",
    retrievedAt: new Date().toISOString(),
    metadata: {
      subreddit: post.subreddit,
      score: post.score,
      createdUtc: post.created_utc,
    },
  }));
}

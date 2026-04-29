import { describe, expect, it } from "vitest";

import { normalizeRedditResponse, REDDIT_CAPABILITY } from "../reddit";

describe("Reddit Connector", () => {
  it("declares read-only and provenance-capable", () => {
    expect(REDDIT_CAPABILITY.defaultAccessMode).toBe("read_only");
    expect(REDDIT_CAPABILITY.supportsProvenance).toBe(true);
    expect(REDDIT_CAPABILITY.kind).toBe("source_connector");
  });

  it("normalizes a Reddit API listing response", () => {
    const rawResponse = {
      data: {
        children: [
          {
            data: {
              id: "abc123",
              title: "Best blackout curtains for sleep",
              selftext: "I've been struggling with light...",
              permalink: "/r/sleep/comments/abc123/best_blackout/",
              subreddit: "sleep",
              score: 142,
              created_utc: 1711000000,
              url: "https://reddit.com/r/sleep/comments/abc123/best_blackout/",
            },
          },
          {
            data: {
              id: "def456",
              title: "Melatonin dosage guide",
              selftext: "Based on research...",
              permalink: "/r/sleep/comments/def456/melatonin/",
              subreddit: "sleep",
              score: 89,
              created_utc: 1711100000,
              url: "https://reddit.com/r/sleep/comments/def456/melatonin/",
            },
          },
        ],
      },
    };

    const results = normalizeRedditResponse(rawResponse);

    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Best blackout curtains for sleep");
    expect(results[0]!.source).toBe("reddit");
    expect(results[0]!.url).toContain("reddit.com");
    expect(results[0]!.metadata?.subreddit).toBe("sleep");
    expect(results[0]!.metadata?.score).toBe(142);
  });

  it("handles empty response", () => {
    const results = normalizeRedditResponse({ data: { children: [] } });
    expect(results).toHaveLength(0);
  });
});

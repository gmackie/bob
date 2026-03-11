import { describe, it, expect } from "vitest";

// Utility function tests
describe("Issue Identifier Extraction", () => {
  const extractIssueIdentifiers = (text: string): string[] => {
    const pattern = /[A-Z]{2,10}-\d+/g;
    return [...new Set(text.match(pattern) ?? [])];
  };

  it("should extract simple issue identifiers", () => {
    expect(extractIssueIdentifiers("Fix ENG-123")).toEqual(["ENG-123"]);
  });

  it("should extract multiple identifiers", () => {
    expect(extractIssueIdentifiers("Fix ENG-123 and TEAM-45")).toEqual([
      "ENG-123",
      "TEAM-45",
    ]);
  });

  it("should handle duplicates", () => {
    expect(extractIssueIdentifiers("ENG-123 ENG-123")).toEqual(["ENG-123"]);
  });

  it("should extract from branch names", () => {
    expect(extractIssueIdentifiers("feature/ENG-123-add-login")).toEqual([
      "ENG-123",
    ]);
  });

  it("should return empty array for no matches", () => {
    expect(extractIssueIdentifiers("No issue here")).toEqual([]);
  });

  it("should handle long team keys up to 10 chars", () => {
    // ENGINEERIN is exactly 10 chars (the max)
    expect(extractIssueIdentifiers("ENGINEERIN-999")).toEqual([
      "ENGINEERIN-999",
    ]);
  });

  it("should not match team keys over 10 chars", () => {
    // ENGINEERING is 11 chars - should only match NGINEERING-999 (10 chars)
    expect(extractIssueIdentifiers("ENGINEERING-999")).not.toContain(
      "ENGINEERING-999"
    );
  });

  it("should not match single letter prefixes", () => {
    expect(extractIssueIdentifiers("A-123")).toEqual([]);
  });
});

describe("Status Helpers", () => {
  const isActiveStatus = (status: string): boolean => {
    return ["in_progress", "in_review"].includes(status);
  };

  const isClosedStatus = (status: string): boolean => {
    return ["done", "canceled"].includes(status);
  };

  it("should identify active statuses", () => {
    expect(isActiveStatus("in_progress")).toBe(true);
    expect(isActiveStatus("in_review")).toBe(true);
    expect(isActiveStatus("todo")).toBe(false);
    expect(isActiveStatus("done")).toBe(false);
  });

  it("should identify closed statuses", () => {
    expect(isClosedStatus("done")).toBe(true);
    expect(isClosedStatus("canceled")).toBe(true);
    expect(isClosedStatus("in_progress")).toBe(false);
    expect(isClosedStatus("backlog")).toBe(false);
  });
});

describe("Priority Helpers", () => {
  const priorityOrder: Record<string, number> = {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4,
    no_priority: 5,
  };

  const comparePriority = (a: string, b: string): number => {
    return (priorityOrder[a] ?? 5) - (priorityOrder[b] ?? 5);
  };

  it("should sort priorities correctly", () => {
    const priorities = ["low", "urgent", "medium", "high"];
    const sorted = priorities.sort(comparePriority);
    expect(sorted).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("should handle no_priority", () => {
    expect(comparePriority("urgent", "no_priority")).toBeLessThan(0);
    expect(comparePriority("no_priority", "low")).toBeGreaterThan(0);
  });
});

describe("Date Formatting", () => {
  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  it("should format just now", () => {
    expect(formatRelativeTime(new Date())).toBe("Just now");
  });

  it("should format minutes ago", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("should format hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("should format days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });
});

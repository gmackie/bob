import { describe, expect, it } from "vitest";

import { formatThreadList, type ThreadListItem } from "../commands/threads";

const SAMPLE_THREADS: ThreadListItem[] = [
  {
    title: "Sleep Research",
    slug: "sleep-research",
    notesCount: 3,
    created: "2025-01-15T10:00:00.000Z",
  },
  {
    title: "Biomedical Survey",
    slug: "biomedical-survey",
    notesCount: 0,
    created: "2025-02-01T12:00:00.000Z",
  },
];

describe("formatThreadList", () => {
  it("formats thread list as a table", () => {
    const output = formatThreadList(SAMPLE_THREADS);

    expect(output).toContain("Sleep Research");
    expect(output).toContain("sleep-research");
    expect(output).toContain("NOTES");
    expect(output).toContain("3");
  });

  it("formats thread list as JSON with json flag", () => {
    const output = formatThreadList(SAMPLE_THREADS, { json: true });

    const parsed = JSON.parse(output) as ThreadListItem[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.title).toBe("Sleep Research");
    expect(parsed[0]!.notesCount).toBe(3);
  });

  it("handles empty list", () => {
    const output = formatThreadList([]);

    expect(output).toContain("No threads");
  });
});

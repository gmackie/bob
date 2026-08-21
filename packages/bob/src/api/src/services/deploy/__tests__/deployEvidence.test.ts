import { describe, expect, it } from "vitest";

import { summarizeDeployEvidence } from "../deployEvidence";

const SHA = "0f1557789abcdef0123456789abcdef012345678";

describe("summarizeDeployEvidence", () => {
  it("reports none when nothing on the merge SHA looks like a deploy", () => {
    const r = summarizeDeployEvidence({
      mergeSha: SHA,
      actionRuns: [{ name: "ci", status: "success", headSha: SHA }],
      fgDeployments: [],
    });
    expect(r.outcome).toBe("none");
  });

  it("picks up a deploy-named Actions run on the merge SHA", () => {
    const r = summarizeDeployEvidence({
      mergeSha: SHA,
      actionRuns: [
        { name: "ci", status: "success", headSha: SHA },
        { name: "Deploy habit-app (apps/web)", status: "success", headSha: SHA, url: "https://x/runs/1" },
        { name: "Deploy habit-app (apps/web)", status: "failure", headSha: "other" },
      ],
      fgDeployments: [],
    });
    expect(r.outcome).toBe("success");
    expect(r.details).toHaveLength(1);
    expect(r.details[0]).toMatchObject({ source: "actions", label: "Deploy habit-app (apps/web)", url: "https://x/runs/1" });
  });

  it("ignores runs on other SHAs and treats in-flight runs as pending", () => {
    const r = summarizeDeployEvidence({
      mergeSha: SHA,
      actionRuns: [{ name: "deploy", status: "running", headSha: SHA }],
      fgDeployments: [],
    });
    expect(r.outcome).toBe("pending");
  });

  it("maps ForgeGraph deployment statuses and names the stage", () => {
    const ok = summarizeDeployEvidence({
      mergeSha: SHA,
      actionRuns: [],
      fgDeployments: [{ commitSha: SHA, status: "active", stage: "production" }],
    });
    expect(ok.outcome).toBe("success");
    expect(ok.details[0]).toMatchObject({ source: "forgegraph", label: "production" });
    const bad = summarizeDeployEvidence({
      mergeSha: SHA,
      actionRuns: [],
      fgDeployments: [{ commitSha: SHA, status: "failed", stage: "staging", failureReason: "health check" }],
    });
    expect(bad.outcome).toBe("failure");
  });

  it("failure dominates pending dominates success", () => {
    const r = summarizeDeployEvidence({
      mergeSha: SHA,
      actionRuns: [
        { name: "deploy web", status: "success", headSha: SHA },
        { name: "deploy api", status: "failure", headSha: SHA },
        { name: "release", status: "running", headSha: SHA },
      ],
      fgDeployments: [],
    });
    expect(r.outcome).toBe("failure");
    expect(r.details.map((d) => d.status)).toEqual(["success", "failure", "pending"]);
  });

  it("matches SHAs case-insensitively and by prefix", () => {
    const r = summarizeDeployEvidence({
      mergeSha: SHA.toUpperCase(),
      actionRuns: [{ name: "Publish", status: "success", headSha: SHA.slice(0, 12) }],
      fgDeployments: [],
    });
    expect(r.outcome).toBe("success");
  });
});

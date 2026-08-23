import { describe, expect, it } from "vitest";

import { derivePipeline  } from "../pipeline";
import type {PipelineFacts} from "../pipeline";

const base: PipelineFacts = {
  merged: false, closed: false, mergeable: true, ciState: "pending", ciTotal: 1,
  verdict: null, reviewInFlight: false, repairAttempts: 0, repairCap: 3, repairInFlight: false, deploy: null,
};

describe("derivePipeline", () => {
  it("fresh PR: CI running, review waiting", () => {
    const { stages, parkedReason } = derivePipeline(base);
    expect(stages).toMatchObject({ code: "done", ci: "active", review: "waiting", repair: "skipped", merge: "waiting" });
    expect(parkedReason).toBeNull();
  });

  it("review in flight lights the review stage", () => {
    expect(derivePipeline({ ...base, reviewInFlight: true }).stages.review).toBe("active");
  });

  it("green + approved + mergeable → merge is imminent", () => {
    const { stages } = derivePipeline({ ...base, ciState: "success", verdict: "APPROVED" });
    expect(stages.ci).toBe("done"); expect(stages.review).toBe("done"); expect(stages.merge).toBe("active");
  });

  it("REQUEST_CHANGES routes through repair", () => {
    const { stages } = derivePipeline({ ...base, ciState: "success", verdict: "REQUEST_CHANGES", repairInFlight: true });
    expect(stages.review).toBe("failed"); expect(stages.repair).toBe("active");
  });

  it("CI red with repair cap reached parks the PR with a reason", () => {
    const r = derivePipeline({ ...base, ciState: "failure", repairAttempts: 3 });
    expect(r.stages.ci).toBe("failed"); expect(r.stages.repair).toBe("failed");
    expect(r.parkedReason).toMatch(/repair cap 3/);
  });

  it("approved but zero CI checks is parked for a human (the merge gate needs ≥1 check)", () => {
    const r = derivePipeline({ ...base, ciState: "none", ciTotal: 0, verdict: "APPROVED" });
    expect(r.stages.merge).not.toBe("active");
    expect(r.parkedReason).toMatch(/no CI checks/);
  });

  it("merged with deploy evidence", () => {
    expect(derivePipeline({ ...base, merged: true, ciState: "success", verdict: "APPROVED", deploy: "success" }).stages).toMatchObject({ merge: "done", deploy: "done" });
    expect(derivePipeline({ ...base, merged: true, deploy: "failure" }).stages.deploy).toBe("failed");
    expect(derivePipeline({ ...base, merged: true, deploy: "none" }).stages.deploy).toBe("skipped");
  });

  it("closed without merge fails the merge stage", () => {
    const r = derivePipeline({ ...base, closed: true });
    expect(r.stages.merge).toBe("failed"); expect(r.parkedReason).toMatch(/closed/);
  });

  it("a prior successful repair shows as done once things are green", () => {
    expect(derivePipeline({ ...base, ciState: "success", verdict: "APPROVED", repairAttempts: 1 }).stages.repair).toBe("done");
  });
});

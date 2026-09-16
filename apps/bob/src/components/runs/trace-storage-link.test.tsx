import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TraceStorageLink } from "./trace-storage-link";
describe("trace storage status presentation", () => {
  it("distinguishes stored, pending and unavailable storage evidence", () => {
    const render = (state: "stored" | "pending" | "unavailable") =>
      renderToStaticMarkup(
        <TraceStorageLink
          runId="run/1"
          artifactId="a"
          state={state}
          checking={false}
          onRefresh={() => {}}
        />,
      );
    expect(render("stored")).toContain("Stored in trace backend");
    expect(render("pending")).toContain("Awaiting trace export");
    expect(render("unavailable")).toContain("Storage not verified");
    expect(render("stored")).toContain("/api/runs/run%2F1/traces/a");
  });
  it("does not offer a misleading link for sampled-out work", () => {
    const html = renderToStaticMarkup(
      <TraceStorageLink
        runId="run"
        artifactId="a"
        state="sampled_out"
        checking={false}
        onRefresh={() => {}}
      />,
    );
    expect(html).toContain("Not sampled");
    expect(html).not.toContain("href=");
  });
});

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runEditorialSync } from "../commands/editorial-sync";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function response(data: unknown): Response {
  return new Response(JSON.stringify({ result: { data: { json: data } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function claim(destination: "gmacko" | "obsidian" | "substack") {
  return {
    deliveryId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    itemId: "33333333-3333-4333-8333-333333333333",
    destination,
    claimToken: "a".repeat(64),
    leaseExpiresAt: "2026-08-09T04:00:00.000Z",
    envelope: {
      contractVersion: 1,
      kind: "weekly_editorial_export",
      idempotencyKey: "export-key",
      destination: {
        name: destination,
        relativePath:
          destination === "gmacko"
            ? "_drafts/weekly-update.md"
            : "Content/Build Updates/weekly-update.md",
        scaffold: "# Human draft required\n",
        writeMode: "create_or_verify_same_content",
        autoPublishAllowed: false,
      },
      humanAuthorship: {
        finalProseRequired: true,
        humanApprovalRequiredForPublication: true,
      },
    },
  };
}

describe("runEditorialSync", () => {
  it("reports a heartbeat after completing an empty queue poll", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ claims: [] }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          executor: "ooda-editorial-sync",
          lastActiveAt: "2026-08-10T12:00:00.000Z",
        }),
      );

    const result = await runEditorialSync({
      apiUrl: "https://bizpulse.test",
      apiKey: "biz_test",
      fetchImpl,
    });

    expect(result).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      deliveries: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://bizpulse.test/api/trpc/weeklyReview.reportEditorialExecutorHeartbeat",
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ json: {} }),
    );
  });

  it("writes an unpublished scaffold and records a success receipt", async () => {
    const websitePath = mkdtempSync(join(tmpdir(), "ooda-editorial-site-"));
    roots.push(websitePath);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ claims: [claim("gmacko")] }))
      .mockResolvedValueOnce(response({ deliveryStatus: "succeeded" }))
      .mockResolvedValueOnce(response({ ok: true }));

    const result = await runEditorialSync({
      apiUrl: "https://bizpulse.test",
      apiKey: "biz_test",
      websitePath,
      personalVaultPath: websitePath,
      fetchImpl,
    });

    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(
      readFileSync(join(websitePath, "_drafts/weekly-update.md"), "utf8"),
    ).toBe("# Human draft required\n");
    const receipt = JSON.parse(
      (fetchImpl.mock.calls[1]?.[1]?.body as string) ?? "{}",
    ) as { json: Record<string, unknown> };
    expect(receipt.json).toMatchObject({
      outcome: "succeeded",
      externalPath: "_drafts/weekly-update.md",
      metadata: { writeStatus: "created", autoPublishAllowed: false },
    });
  });

  it("accepts an identical retry without rewriting", async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), "ooda-editorial-vault-"));
    roots.push(vaultPath);
    const filePath = join(vaultPath, "Content/Build Updates/weekly-update.md");
    mkdirSync(join(vaultPath, "Content/Build Updates"), { recursive: true });
    writeFileSync(filePath, "# Human draft required\n");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ claims: [claim("obsidian")] }))
      .mockResolvedValueOnce(response({ deliveryStatus: "succeeded" }))
      .mockResolvedValueOnce(response({ ok: true }));

    await runEditorialSync({
      apiUrl: "https://bizpulse.test",
      apiKey: "biz_test",
      websitePath: vaultPath,
      personalVaultPath: vaultPath,
      fetchImpl,
    });

    const receipt = JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string) as {
      json: { metadata: { writeStatus: string } };
    };
    expect(receipt.json.metadata.writeStatus).toBe("unchanged");
  });

  it("preserves human edits and records a retryable failure", async () => {
    const websitePath = mkdtempSync(join(tmpdir(), "ooda-editorial-site-"));
    roots.push(websitePath);
    const drafts = join(websitePath, "_drafts");
    mkdirSync(drafts, { recursive: true });
    writeFileSync(join(drafts, "weekly-update.md"), "human revision\n");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ claims: [claim("gmacko")] }))
      .mockResolvedValueOnce(response({ deliveryStatus: "failed" }))
      .mockResolvedValueOnce(response({ ok: true }));

    const result = await runEditorialSync({
      apiUrl: "https://bizpulse.test",
      apiKey: "biz_test",
      websitePath,
      personalVaultPath: websitePath,
      fetchImpl,
    });

    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    expect(readFileSync(join(drafts, "weekly-update.md"), "utf8")).toBe(
      "human revision\n",
    );
    const receipt = JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string) as {
      json: { outcome: string; error: string };
    };
    expect(receipt.json.outcome).toBe("failed");
    expect(receipt.json.error).toContain("Refusing to overwrite");
  });
});

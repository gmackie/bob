import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateRunnerToken,
  loadRunnerToken,
  validateRunnerToken,
} from "../auth";

describe("Runner Auth", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "ooda-auth-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("generates a token file at {storageRoot}/.runner-token", () => {
    const token = generateRunnerToken(storageRoot);

    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(32);

    const tokenPath = join(storageRoot, ".runner-token");
    expect(existsSync(tokenPath)).toBe(true);
    expect(readFileSync(tokenPath, "utf-8").trim()).toBe(token);
  });

  it("returns existing token if file already exists", () => {
    const token1 = generateRunnerToken(storageRoot);
    const token2 = generateRunnerToken(storageRoot);

    expect(token1).toBe(token2);
  });

  it("loads token from file", () => {
    const token = generateRunnerToken(storageRoot);
    const loaded = loadRunnerToken(storageRoot);

    expect(loaded).toBe(token);
  });

  it("returns null when no token file exists", () => {
    const loaded = loadRunnerToken(storageRoot);
    expect(loaded).toBeNull();
  });

  it("validates a correct token", () => {
    const token = generateRunnerToken(storageRoot);
    expect(validateRunnerToken(storageRoot, token)).toBe(true);
  });

  it("rejects an incorrect token", () => {
    generateRunnerToken(storageRoot);
    expect(validateRunnerToken(storageRoot, "wrong-token")).toBe(false);
  });

  it("rejects when no token file exists", () => {
    expect(validateRunnerToken(storageRoot, "any-token")).toBe(false);
  });

  it("creates a token file that exists and is not empty", () => {
    const token = generateRunnerToken(storageRoot);
    const tokenPath = join(storageRoot, ".runner-token");

    expect(existsSync(tokenPath)).toBe(true);

    const contents = readFileSync(tokenPath, "utf-8");
    expect(contents.trim().length).toBeGreaterThan(0);
    expect(contents.trim()).toBe(token);
  });
});

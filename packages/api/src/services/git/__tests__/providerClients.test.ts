import { describe, expect, it } from "vitest";

import { createGiteaClient } from "../providers/gitea";
import { createGitHubClient } from "../providers/github";
import { createGitLabClient } from "../providers/gitlab";

describe("Git Provider Clients", () => {
  describe("GitHub Client", () => {
    it("should create a client with correct provider", () => {
      const client = createGitHubClient("test-token");
      expect(client.provider).toBe("github");
    });

    it("should have all required interface methods", () => {
      const client = createGitHubClient("test-token");

      expect(typeof client.getAuthenticatedUser).toBe("function");
      expect(typeof client.getRepository).toBe("function");
      expect(typeof client.listBranches).toBe("function");
      expect(typeof client.listCommits).toBe("function");
      expect(typeof client.createPullRequest).toBe("function");
      expect(typeof client.getPullRequest).toBe("function");
      expect(typeof client.updatePullRequest).toBe("function");
      expect(typeof client.mergePullRequest).toBe("function");
      expect(typeof client.listPullRequestCommits).toBe("function");
    });
  });

  describe("GitLab Client", () => {
    it("should create a client with correct provider", () => {
      const client = createGitLabClient("test-token");
      expect(client.provider).toBe("gitlab");
    });

    it("should create a client with custom instance URL", () => {
      const client = createGitLabClient(
        "test-token",
        "https://gitlab.example.com",
      );
      expect(client.provider).toBe("gitlab");
    });

    it("should have all required interface methods", () => {
      const client = createGitLabClient("test-token");

      expect(typeof client.getAuthenticatedUser).toBe("function");
      expect(typeof client.getRepository).toBe("function");
      expect(typeof client.listBranches).toBe("function");
      expect(typeof client.listCommits).toBe("function");
      expect(typeof client.createPullRequest).toBe("function");
      expect(typeof client.getPullRequest).toBe("function");
      expect(typeof client.updatePullRequest).toBe("function");
      expect(typeof client.mergePullRequest).toBe("function");
      expect(typeof client.listPullRequestCommits).toBe("function");
    });
  });

  describe("Gitea Client", () => {
    it("should create a client with correct provider", () => {
      const client = createGiteaClient(
        "test-token",
        "https://gitea.example.com",
      );
      expect(client.provider).toBe("gitea");
    });

    it("should have all required interface methods", () => {
      const client = createGiteaClient(
        "test-token",
        "https://gitea.example.com",
      );

      expect(typeof client.getAuthenticatedUser).toBe("function");
      expect(typeof client.getRepository).toBe("function");
      expect(typeof client.listBranches).toBe("function");
      expect(typeof client.listCommits).toBe("function");
      expect(typeof client.createPullRequest).toBe("function");
      expect(typeof client.getPullRequest).toBe("function");
      expect(typeof client.updatePullRequest).toBe("function");
      expect(typeof client.mergePullRequest).toBe("function");
      expect(typeof client.listPullRequestCommits).toBe("function");
    });
  });

  describe("Provider Types", () => {
    it("all clients should use the same interface shape", () => {
      const github = createGitHubClient("token");
      const gitlab = createGitLabClient("token");
      const gitea = createGiteaClient("token", "https://gitea.example.com");

      const methodNames = [
        "getAuthenticatedUser",
        "getRepository",
        "listBranches",
        "listCommits",
        "createPullRequest",
        "getPullRequest",
        "updatePullRequest",
        "mergePullRequest",
        "listPullRequestCommits",
      ] as const;

      for (const method of methodNames) {
        expect(typeof github[method]).toBe("function");
        expect(typeof gitlab[method]).toBe("function");
        expect(typeof gitea[method]).toBe("function");
      }
    });
  });
});

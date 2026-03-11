import { existsSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { repositories } from "@bob/db/schema";

import { getSession } from "~/auth/server";
import {
  getUnifiedReposForUser,
  runGit,
  safeRepoDirName,
} from "~/server/git/user-repos";
import { getServices } from "~/server/services";

function ensureLegacyRepoForPath(input: {
  gitService: Awaited<ReturnType<typeof getServices>>["gitService"];
  repoPath: string;
  userId: string;
}) {
  const existing = input.gitService
    .getRepositories(input.userId)
    .find((r) => r.path === input.repoPath);
  if (existing) return existing;
  return input.gitService.addRepository(input.repoPath, input.userId);
}

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

type MapBody = {
  provider: "gitea" | "github";
  fullName: string;
  instanceUrl?: string | null;
  clone?: boolean;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  let body: MapBody;
  try {
    body = (await request.json()) as MapBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  const fullName = (body.fullName ?? "").trim();
  const instanceUrl = body.instanceUrl ?? null;
  const shouldClone = body.clone !== false;

  if (!provider || (provider !== "gitea" && provider !== "github")) {
    return NextResponse.json(
      { error: "provider is required" },
      { status: 400 },
    );
  }
  if (!fullName) {
    return NextResponse.json(
      { error: "fullName is required" },
      { status: 400 },
    );
  }

  try {
    const { unified } = await getUnifiedReposForUser(session.user.id);
    const match = unified.find(
      (u) => u.fullName.toLowerCase() === fullName.toLowerCase(),
    );
    if (!match) {
      return NextResponse.json(
        { error: `Repository not found in connected providers: ${fullName}` },
        { status: 404 },
      );
    }

    const source =
      provider === "gitea" ? match.sources.gitea : match.sources.github;
    if (!source) {
      return NextResponse.json(
        { error: `Repository not available from ${provider}: ${fullName}` },
        { status: 404 },
      );
    }

    const reposDir =
      process.env.BOB_REPOS_DIR || path.join(os.homedir(), "bob-repos");
    if (!existsSync(reposDir)) mkdirSync(reposDir, { recursive: true });

    const clonePath = path.join(reposDir, safeRepoDirName(fullName));
    if (!existsSync(clonePath)) {
      if (!shouldClone) {
        return NextResponse.json(
          { error: `Repo not cloned locally: ${clonePath}` },
          { status: 412 },
        );
      }
      await runGit(["clone", "--", source.repo.sshUrl, clonePath]);
    }

    const existingForProject = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.userId, session.user.id),
        eq(repositories.kanbangerProjectId, projectId),
      ),
    });

    if (existingForProject && existingForProject.path !== clonePath) {
      return NextResponse.json(
        {
          error: `Project already mapped to a different repo path (${existingForProject.path})`,
        },
        { status: 409 },
      );
    }

    const existingByPath = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.userId, session.user.id),
        eq(repositories.path, clonePath),
      ),
    });

    if (
      existingByPath?.kanbangerProjectId &&
      existingByPath.kanbangerProjectId !== projectId
    ) {
      return NextResponse.json(
        {
          error: `Repo path already mapped to a different project (${existingByPath.kanbangerProjectId})`,
        },
        { status: 409 },
      );
    }

    const { gitService } = await getServices();
    const legacyRepo = await ensureLegacyRepoForPath({
      gitService,
      repoPath: clonePath,
      userId: session.user.id,
    });

    const remoteUrl = source.repo.sshUrl;
    const remoteOwner = source.repo.owner;
    const remoteName = source.repo.name;

    if (existingByPath) {
      const [updated] = await db
        .update(repositories)
        .set({
          kanbangerProjectId: projectId,
          remoteUrl,
          remoteProvider: provider,
          remoteOwner,
          remoteName,
          remoteInstanceUrl: instanceUrl,
        })
        .where(
          and(
            eq(repositories.id, existingByPath.id),
            eq(repositories.userId, session.user.id),
          ),
        )
        .returning();

      return NextResponse.json({ repository: updated }, { status: 200 });
    }

    const [inserted] = await db
      .insert(repositories)
      .values({
        userId: session.user.id,
        kanbangerProjectId: projectId,
        name: legacyRepo.name,
        path: legacyRepo.path,
        branch: legacyRepo.branch,
        mainBranch: legacyRepo.mainBranch,
        remoteUrl,
        remoteProvider: provider,
        remoteOwner,
        remoteName,
        remoteInstanceUrl: instanceUrl,
      })
      .returning();

    return NextResponse.json({ repository: inserted }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  try {
    const updated = await db
      .update(repositories)
      .set({ kanbangerProjectId: null })
      .where(
        and(
          eq(repositories.userId, session.user.id),
          eq(repositories.kanbangerProjectId, projectId),
        ),
      )
      .returning({ id: repositories.id });

    return NextResponse.json({ unmapped: updated.length }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

import { existsSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface CloneBody {
  repoFullName: string;
  branch?: string;
}

/**
 * POST /api/legacy/git/github/clone
 * Clone a GitHub repository
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = (await request.json()) as CloneBody;
    const { repoFullName, branch } = body;

    if (!repoFullName) {
      return NextResponse.json(
        { error: "Repository name is required" },
        { status: 400 },
      );
    }

    const { gitService } = await getServices();

    const reposDir =
      process.env.BOB_REPOS_DIR || path.join(os.homedir(), "bob-repos");
    const repoName = repoFullName.split("/")[1];
    const clonePath = path.join(reposDir, repoName || repoFullName);

    if (!existsSync(reposDir)) {
      mkdirSync(reposDir, { recursive: true });
    }

    if (existsSync(clonePath)) {
      const repository = await gitService.addRepository(clonePath, userId);
      return NextResponse.json({
        message: "Repository already exists, added to Bob",
        repository,
        clonePath,
      });
    }

    await execAsync(`gh repo clone ${repoFullName} "${clonePath}"`);

    if (branch && branch !== "main" && branch !== "master") {
      await execAsync(`git checkout ${branch}`, { cwd: clonePath });
    }

    const repository = await gitService.addRepository(clonePath, userId);

    return NextResponse.json({
      message: "Repository cloned and added successfully",
      repository,
      clonePath,
    });
  } catch (error) {
    console.error("Error cloning repository:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

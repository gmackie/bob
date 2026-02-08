import { NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getUnifiedReposForUser } from "~/server/git/user-repos";

export async function GET() {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { unified, connections } = await getUnifiedReposForUser(
      session.user.id,
    );

    return NextResponse.json({
      connections,
      repos: unified.map((u) => ({
        fullName: u.fullName,
        preferred: {
          provider: u.preferred.provider,
          instanceUrl: u.preferred.instanceUrl,
          sshUrl: u.preferred.repo.sshUrl,
          htmlUrl: u.preferred.repo.htmlUrl,
          defaultBranch: u.preferred.repo.defaultBranch,
          isPrivate: u.preferred.repo.isPrivate,
        },
        sources: {
          gitea: u.sources.gitea
            ? {
                instanceUrl: u.sources.gitea.instanceUrl,
                sshUrl: u.sources.gitea.repo.sshUrl,
                htmlUrl: u.sources.gitea.repo.htmlUrl,
                defaultBranch: u.sources.gitea.repo.defaultBranch,
                isPrivate: u.sources.gitea.repo.isPrivate,
              }
            : null,
          github: u.sources.github
            ? {
                instanceUrl: u.sources.github.instanceUrl,
                sshUrl: u.sources.github.repo.sshUrl,
                htmlUrl: u.sources.github.repo.htmlUrl,
                defaultBranch: u.sources.github.repo.defaultBranch,
                isPrivate: u.sources.github.repo.isPrivate,
              }
            : null,
        },
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

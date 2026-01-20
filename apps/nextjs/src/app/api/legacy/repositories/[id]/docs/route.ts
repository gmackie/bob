import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RepoDocMeta {
  name: string;
  relativePath: string;
  size: number;
  mtime: number;
}

async function listRepositoryDocs(root: string): Promise<RepoDocMeta[]> {
  const preferred = [
    "README.md",
    "README.MD",
    "readme.md",
    "CLAUDE.md",
    "CLAUDE.MD",
    "AGENTS.md",
    "AGENTS.MD",
    "CONTRIBUTING.md",
    "CONTRIBUTING.MD",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "CODE-OF-CONDUCT.md",
    "RELEASE.md",
    "CHANGELOG.md",
    "LICENSE",
    "LICENSE.md",
  ];

  const results: RepoDocMeta[] = [];

  const tryAddFile = async (rel: string) => {
    const abs = path.join(root, rel);
    try {
      const st = await fs.stat(abs);
      if (st.isFile()) {
        results.push({
          name: path.basename(rel),
          relativePath: rel,
          size: st.size,
          mtime: st.mtimeMs,
        });
      }
    } catch {}
  };

  for (const f of preferred) {
    await tryAddFile(f);
  }

  const docsDir = path.join(root, "docs");
  try {
    const entries = await fs.readdir(docsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        await tryAddFile(path.join("docs", ent.name));
      }
    }
  } catch {}

  const planningDir = path.join(root, "docs", "planning");
  try {
    const entries = await fs.readdir(planningDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        await tryAddFile(path.join("docs", "planning", ent.name));
      }
    }
  } catch {}

  const dedup = new Map(results.map((r) => [r.relativePath, r]));
  return Array.from(dedup.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { gitService } = await getServices();
    const repository = gitService.getRepository(id, userId);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }

    const list = await listRepositoryDocs(repository.path);
    return NextResponse.json(list);
  } catch (error) {
    console.error("Failed to list docs:", error);
    return NextResponse.json(
      { error: `Failed to list docs: ${error}` },
      { status: 500 },
    );
  }
}

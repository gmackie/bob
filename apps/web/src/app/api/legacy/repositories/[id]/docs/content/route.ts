import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function readRepositoryDoc(root: string, rel: string): Promise<string> {
  const abs = path.resolve(path.join(root, rel));
  const normalizedRepo = path.resolve(root);
  if (!abs.startsWith(normalizedRepo + path.sep) && abs !== normalizedRepo) {
    throw new Error("Invalid path");
  }
  return fs.readFile(abs, "utf-8");
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const { searchParams } = new URL(request.url);
    const relativePath = searchParams.get("path") ?? "";

    if (!relativePath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const content = await readRepositoryDoc(repository.path, relativePath);
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error("Failed to read doc content:", error);
    return NextResponse.json(
      { error: `Failed to read doc content: ${error}` },
      { status: 500 },
    );
  }
}

import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
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

    const notesPath = path.join(
      repository.path,
      "docs",
      "notes",
      ".bob-repo.md",
    );

    try {
      const content = await fs.readFile(notesPath, "utf-8");
      return new NextResponse(content, {
        headers: { "Content-Type": "text/plain" },
      });
    } catch (readErr: unknown) {
      if (
        readErr &&
        typeof readErr === "object" &&
        "code" in readErr &&
        readErr.code === "ENOENT"
      ) {
        return new NextResponse("", { status: 404 });
      }
      throw readErr;
    }
  } catch (error) {
    console.error("Failed to get project notes:", error);
    return NextResponse.json(
      { error: `Failed to get project notes: ${error}` },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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

    const body = (await request.json()) as { notes?: string };
    const { notes } = body;

    if (typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 },
      );
    }

    const notesDir = path.join(repository.path, "docs", "notes");
    const notesPath = path.join(notesDir, ".bob-repo.md");

    await fs.mkdir(notesDir, { recursive: true });
    await fs.writeFile(notesPath, notes, "utf-8");

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to save project notes:", error);
    return NextResponse.json(
      { error: `Failed to save project notes: ${error}` },
      { status: 500 },
    );
  }
}

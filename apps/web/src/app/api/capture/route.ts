import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

const CAPTURE_DIR = join(process.cwd(), "public", "uploads", "captures");

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      targetType: "browser" | "window" | "screen";
      targetId?: string;
      url?: string;
    };
    const { targetType, targetId, url } = body;

    await mkdir(CAPTURE_DIR, { recursive: true });
    const filename = `capture-${randomUUID()}.png`;
    const filepath = join(CAPTURE_DIR, filename);

    if (targetType === "browser" && url) {
      // For browser targets, generate a placeholder SVG indicating the URL
      // In production this would use Playwright for actual screenshots
      const placeholderSvg = generatePlaceholderCapture(url, 1280, 720);
      await writeFile(filepath.replace(".png", ".svg"), placeholderSvg);
    } else if (targetType === "window" && targetId) {
      // macOS window capture
      try {
        execSync(`screencapture -l ${targetId} "${filepath}"`, {
          timeout: 5000,
        });
      } catch {
        // Fall back to full screen capture
        execSync(`screencapture -x "${filepath}"`, { timeout: 5000 });
      }
    } else {
      // Full screen capture
      execSync(`screencapture -x "${filepath}"`, { timeout: 5000 });
    }

    const captureUrl = `/uploads/captures/${filename}`;
    return NextResponse.json({
      url: captureUrl,
      filename,
      width: 1280,
      height: 720,
      capturedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Capture error:", error);
    return NextResponse.json({ error: "Capture failed" }, { status: 500 });
  }
}

function generatePlaceholderCapture(
  url: string,
  width: number,
  height: number,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#1C1B18"/>
    <text x="50%" y="50%" text-anchor="middle" fill="#8A877E" font-family="monospace" font-size="14">
      Capture: ${url}
    </text>
  </svg>`;
}

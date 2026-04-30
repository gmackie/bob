/**
 * Capture handler functions — pure business logic extracted from the tRPC
 * capture router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { execSync } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

import type { HandlerContext } from "./context.js";

const CAPTURE_DIR = join(process.cwd(), "public", "uploads", "captures");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function captureListTargets(_ctx: HandlerContext, _input?: void) {
  return [
    {
      id: "browser",
      name: "Browser",
      type: "browser" as const,
      description: "Capture any URL",
      connected: true,
    },
    {
      id: "screen",
      name: "Full Screen",
      type: "screen" as const,
      description: "Capture entire screen",
      connected: true,
    },
    {
      id: "window",
      name: "Window",
      type: "window" as const,
      description: "Capture a specific window",
      connected: process.platform === "darwin",
    },
  ];
}

export async function captureCapture(
  _ctx: HandlerContext,
  input: { targetType: "browser" | "window" | "screen"; targetId?: string; url?: string },
) {
  const { targetType, targetId, url } = input;

  await mkdir(CAPTURE_DIR, { recursive: true });
  const filename = `capture-${randomUUID()}.png`;
  const filepath = join(CAPTURE_DIR, filename);

  if (targetType === "browser" && url) {
    // Generate a placeholder SVG for browser captures
    // In production this would use Playwright
    const placeholderSvg = generatePlaceholderCapture(url, 1280, 720);
    await writeFile(filepath.replace(".png", ".svg"), placeholderSvg);
  } else if (targetType === "window" && targetId) {
    try {
      execSync(`screencapture -l ${targetId} "${filepath}"`, {
        timeout: 5000,
      });
    } catch {
      execSync(`screencapture -x "${filepath}"`, { timeout: 5000 });
    }
  } else {
    execSync(`screencapture -x "${filepath}"`, { timeout: 5000 });
  }

  const captureUrl = `/uploads/captures/${filename}`;
  return {
    url: captureUrl,
    filename,
    width: 1280,
    height: 720,
    capturedAt: new Date().toISOString(),
  };
}

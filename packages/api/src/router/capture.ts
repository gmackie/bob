import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { join } from "path";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { captureUrl as captureBrowserUrl } from "@bob/execution-lib/capture/playwright-capture";

import { protectedProcedure } from "../trpc";

const CAPTURE_DIR = join(process.cwd(), "public", "uploads", "captures");

export const captureRouter = {
  listTargets: protectedProcedure.query(() => {
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
  }),

  capture: protectedProcedure
    .input(
      z.object({
        targetType: z.enum(["browser", "window", "screen"]),
        targetId: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { targetType, targetId, url } = input;

      await mkdir(CAPTURE_DIR, { recursive: true });
      const filename = `capture-${randomUUID()}.png`;
      const filepath = join(CAPTURE_DIR, filename);
      let width = 1280;
      let height = 720;

      if (targetType === "browser") {
        if (!url) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Browser captures require a URL",
          });
        }

        const captured = await captureBrowserUrl(url, { outputPath: filepath });
        width = captured.width;
        height = captured.height;
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
        width,
        height,
        capturedAt: new Date().toISOString(),
      };
    }),
} satisfies TRPCRouterRecord;

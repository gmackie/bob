import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const AGENT_CONFIG_PATHS: Record<string, { dir: string; files: string[] }> = {
  claude: {
    dir: ".claude",
    files: ["settings.json", "settings.local.json", "config.json"],
  },
  gemini: {
    dir: ".gemini",
    files: ["settings.json", "config.json"],
  },
  opencode: {
    dir: ".opencode",
    files: ["config.json", "settings.json"],
  },
  kiro: {
    dir: ".kiro",
    files: ["settings.json", "config.json"],
  },
  codex: {
    dir: ".codex",
    files: ["config.json", "settings.json"],
  },
};

interface RouteParams {
  params: Promise<{ type: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { type: agentType } = await params;
    const configInfo = AGENT_CONFIG_PATHS[agentType];

    if (!configInfo) {
      return NextResponse.json(
        { error: `Unknown agent type: ${agentType}` },
        { status: 404 },
      );
    }

    const homeDir = os.homedir();
    const configDir = path.join(homeDir, configInfo.dir);

    const files: Array<{
      name: string;
      path: string;
      exists: boolean;
      content?: string;
    }> = [];

    for (const fileName of configInfo.files) {
      const filePath = path.join(configDir, fileName);
      const exists = fs.existsSync(filePath);
      let content: string | undefined;

      if (exists) {
        try {
          content = fs.readFileSync(filePath, "utf-8");
        } catch {}
      }

      files.push({
        name: fileName,
        path: filePath,
        exists,
        content,
      });
    }

    if (fs.existsSync(configDir)) {
      try {
        const allFiles = fs.readdirSync(configDir);
        for (const fileName of allFiles) {
          if (
            fileName.endsWith(".json") &&
            !configInfo.files.includes(fileName)
          ) {
            const filePath = path.join(configDir, fileName);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              let content: string | undefined;
              try {
                content = fs.readFileSync(filePath, "utf-8");
              } catch {}

              files.push({
                name: fileName,
                path: filePath,
                exists: true,
                content,
              });
            }
          }
        }
      } catch {}
    }

    return NextResponse.json({
      agentType,
      configDir,
      files,
    });
  } catch (error) {
    console.error("Failed to get agent config:", error);
    return NextResponse.json(
      { error: "Failed to get agent config", details: String(error) },
      { status: 500 },
    );
  }
}

interface CreateConfigBody {
  fileName: string;
  content?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { type: agentType } = await params;
    const body = (await request.json()) as CreateConfigBody;
    const { fileName, content } = body;

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 },
      );
    }

    if (!fileName.endsWith(".json")) {
      return NextResponse.json(
        { error: "Only JSON files are allowed" },
        { status: 400 },
      );
    }

    const fileContent = content ?? "{}";
    try {
      JSON.parse(fileContent);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON content" },
        { status: 400 },
      );
    }

    const configInfo = AGENT_CONFIG_PATHS[agentType];
    if (!configInfo) {
      return NextResponse.json(
        { error: `Unknown agent type: ${agentType}` },
        { status: 404 },
      );
    }

    const homeDir = os.homedir();
    const configDir = path.join(homeDir, configInfo.dir);
    const filePath = path.join(configDir, fileName);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "File already exists" },
        { status: 409 },
      );
    }

    fs.writeFileSync(filePath, fileContent, "utf-8");

    return NextResponse.json({
      message: "Config file created successfully",
      path: filePath,
    });
  } catch (error) {
    console.error("Failed to create config file:", error);
    return NextResponse.json(
      { error: "Failed to create config file", details: String(error) },
      { status: 500 },
    );
  }
}

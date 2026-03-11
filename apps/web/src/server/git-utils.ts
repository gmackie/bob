import "server-only";

import { exec, spawn } from "child_process";
import { promisify } from "util";

import type { AgentType } from "@bob/legacy";
import { getAgentCommand } from "@bob/legacy";

export const execAsync = promisify(exec);

/**
 * Helper to call Claude CLI safely with stdin input
 */
export async function callClaude(
  prompt: string,
  input: string,
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudeProcess = spawn(getAgentCommand("claude"), [prompt], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      claudeProcess.kill("SIGTERM");
      reject(new Error("Claude CLI timeout after 2 minutes"));
    }, 120000);

    claudeProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    claudeProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    claudeProcess.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(`Claude CLI exited with code ${code}. stderr: ${stderr}`),
        );
      }
    });

    claudeProcess.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
    });

    claudeProcess.stdin.write(input);
    claudeProcess.stdin.end();
  });
}

/**
 * Generic agent call with graceful fallback to Claude
 */
export async function callAgent(
  agentType: AgentType | undefined,
  prompt: string,
  input: string,
  cwd: string,
): Promise<string> {
  const type = agentType ?? "claude";

  if (type === "claude") {
    return callClaude(prompt, input, cwd);
  }

  try {
    return await new Promise((resolve, reject) => {
      let command = "";
      let args: string[] = [];

      switch (type) {
        case "gemini":
          command = "gemini";
          args = ["--prompt", prompt];
          break;
        case "codex":
          command = "codex";
          args = [prompt];
          break;
        case "kiro":
          throw new Error(
            "Kiro non-interactive commit generation not supported",
          );
        default:
          throw new Error(`Unsupported agent type: ${type}`);
      }

      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`${type} CLI timeout after 2 minutes`));
      }, 120000);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(stdout.trim());
        else
          reject(
            new Error(
              `${type} CLI exited with code ${code}. stderr: ${stderr}`,
            ),
          );
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn ${type} CLI: ${err.message}`));
      });

      child.stdin.write(input);
      child.stdin.end();
    });
  } catch {
    return callClaude(prompt, input, cwd);
  }
}

/**
 * Get comprehensive diff including untracked files
 */
export async function getCompleteDiff(worktreePath: string): Promise<string> {
  const { stdout: diff } = await execAsync("git diff HEAD", {
    cwd: worktreePath,
  });

  const { stdout: status } = await execAsync("git status --porcelain", {
    cwd: worktreePath,
  });

  let completeDiff = diff;

  if (status.trim()) {
    const untrackedFiles = status
      .split("\n")
      .filter((line) => line.startsWith("??"))
      .map((line) => line.substring(3).trim());

    for (const file of untrackedFiles) {
      try {
        const { stdout: fileContent } = await execAsync(`cat "${file}"`, {
          cwd: worktreePath,
        });

        completeDiff += `\ndiff --git a/${file} b/${file}\n`;
        completeDiff += `new file mode 100644\n`;
        completeDiff += `index 0000000..${Math.random().toString(36).substr(2, 7)}\n`;
        completeDiff += `--- /dev/null\n`;
        completeDiff += `+++ b/${file}\n`;
        completeDiff += `@@ -0,0 +1,${fileContent.split("\n").length} @@\n`;

        fileContent.split("\n").forEach((line) => {
          if (
            line.trim() ||
            fileContent.indexOf(line) !== fileContent.lastIndexOf("\n")
          ) {
            completeDiff += `+${line}\n`;
          }
        });
      } catch (fileError) {
        console.warn(`Failed to read untracked file ${file}:`, fileError);
      }
    }
  }

  return completeDiff;
}

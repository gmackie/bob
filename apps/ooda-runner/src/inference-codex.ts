import {
  spawnAdapterProcess,
  killProcessTree,
} from "@gmacko/ooda/agent-adapters";

const DEFAULT_WORKDIR =
  process.env.BOB_DEV_DIR?.trim() ||
  process.env.CODEX_INFERENCE_CWD?.trim() ||
  process.cwd();

const INFERENCE_TIMEOUT_MS = Number.parseInt(
  process.env.CODEX_INFERENCE_TIMEOUT_MS ?? "120000",
  10,
);

/** Map API-facing model aliases to codex CLI slugs. Omit to use codex default. */
export function resolveCodexCliModel(model?: string): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;

  const alias = trimmed.toLowerCase();
  if (alias === "5.6-luna" || alias === "luna" || alias === "gpt-4o-mini") {
    return process.env.CODEX_MODEL?.trim() || undefined;
  }

  return trimmed;
}

function extractAgentText(output: string): string {
  const lines = output.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]!) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (row.type === "item.completed" && row.item?.type === "agent_message") {
        const text = row.item.text?.trim();
        if (text) return text;
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  return "";
}

export async function completeCodexInference(input: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  workspaceRoot?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const cwd = input.workspaceRoot?.trim() || DEFAULT_WORKDIR;
  const model = resolveCodexCliModel(input.model);
  const args = ["exec", "--json", "--skip-git-repo-check", "-C", cwd];

  if (model) {
    args.push("-m", model);
  }

  if (input.systemPrompt?.trim()) {
    args.push(
      "-c",
      `developer_instructions=${JSON.stringify(input.systemPrompt.trim())}`,
    );
  }

  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new Error("Codex inference cancelled"));
      return;
    }
    const child = spawnAdapterProcess("codex", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stopReason: Error | undefined;
    const stop = (error: Error) => {
      stopReason ??= error;
      killProcessTree(child, "SIGTERM");
    };
    const onAbort = () => stop(new Error("Codex inference cancelled"));
    input.signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      stop(
        new Error(`Codex inference timed out after ${INFERENCE_TIMEOUT_MS}ms`),
      );
    }, INFERENCE_TIMEOUT_MS);

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (stopReason) {
        reject(stopReason);
        return;
      }

      const text = extractAgentText(stdout);
      if (code === 0 && text) {
        resolve(text);
        return;
      }

      const detail =
        stderr.trim() || stdout.trim() || `exit ${code ?? "unknown"}`;
      reject(new Error(`Codex inference failed: ${detail.slice(0, 500)}`));
    });
  });
}

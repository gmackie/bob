import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { T3UnavailableError, T3Client, type T3Config, type T3Projection } from "./t3-client";

export interface T3Task {
  sessionId: string;
  providerInstanceId?: string;
  model?: string;
  title: string;
  repoPath: string;
  worktreePath: string;
  branch?: string;
  prompt: string;
  runtimeMode: "approval-required" | "full-access";
}
export const t3ThreadId = (sessionId: string) => `bob-${createHash("sha256").update(sessionId).digest("hex").slice(0,32)}`;
const terminal = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);

export async function launchT3Task(client: T3Client, config: T3Config, task: T3Task) {
  const { projects } = await client.http<{ projects: { id: string; workspaceRoot: string }[] }>("/api/projects");
  let project = projects.find(p => resolve(p.workspaceRoot) === resolve(task.repoPath));
  if (!project) {
    const projectId = `bob-${createHash("sha256").update(resolve(task.repoPath)).digest("hex").slice(0,32)}`;
    await client.http("/api/projects/mutate", {
      type: "project.create", commandId: `bob-project-${projectId}`, projectId,
      title: basename(task.repoPath), workspaceRoot: task.repoPath, createWorkspaceRootIfMissing: false,
    });
    project = { id: projectId, workspaceRoot: task.repoPath };
  }
  const configResult = await client.rpc<{ providers: { instanceId: string; status: string; models: { slug: string; isDefault?: boolean }[] }[] }>("server.getConfig", {});
  const provider = configResult.providers.find(p => p.instanceId === (task.providerInstanceId ?? config.modelInstanceId ?? "codex") && p.status === "ready");
  if (!provider) throw new Error("T3 execution provider is not ready");
  const model = task.model ?? config.model ?? provider.models.find(m => m.isDefault)?.slug;
  if (!model) throw new Error("T3 execution provider has no default model; configure OODA_T3CODE_MODEL");
  const threadId = t3ThreadId(task.sessionId);
  // Stable thread/command/message IDs prevent duplicate execution after a lost reply.
  const result = await client.rpc<{ threadId: string; projection: T3Projection }>("orchestration.launchThread", {
    commandId: `${threadId}-launch`, threadId,
    projectId: project.id, title: task.title, modelSelection: { instanceId: provider.instanceId, model },
    runtimeMode: task.runtimeMode, interactionMode: "default",
    workspaceStrategy: { type: "existing_worktree", worktreePath: task.worktreePath, ...(task.branch ? { branch: task.branch } : {}) },
    initialMessage: { messageId: `${threadId}-message`, text: task.prompt, attachments: [] },
  });
  return result;
}

/** Detached supervisor owns this bridge, so runner deploys don't abandon the T3 run. */
export async function runBridge(config: T3Config, task: T3Task) {
  const client = new T3Client(config);
  const threadId = t3ThreadId(task.sessionId);
  const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  let projection: T3Projection;
  let stopping = false;
  let controls = Promise.resolve();
  const requests = new Set<string>();
  const dispatch = (command: Record<string, unknown>) => client.rpc("orchestration.dispatchCommand", {
    commandId: randomUUID(), threadId, ...command,
  });
  const activeRun = () => projection?.runs.filter(r => !terminal.has(r.status)).sort((a,b) => b.ordinal-a.ordinal)[0];
  const interrupt = async () => {
    stopping = true;
    const current = await client.projection(threadId);
    for (const run of current.runs.filter(r => !terminal.has(r.status))) {
      await dispatch({ type: "run.interrupt", runId: run.id, reason: "Stopped from Bob", holdQueue: true });
    }
  };
  process.on("SIGTERM", () => { stopping = true; });
  const input = createInterface({ input: process.stdin });
  input.on("line", line => {
    controls = controls.then(async () => {
      const message = JSON.parse(line);
      if (message.type === "stop") {
        stopping = true;
      } else if (message.type === "user") {
        const question = projection?.runtimeRequests.find(r => r.kind === "user_input" && r.status === "pending");
        if (question) {
          const item = projection.turnItems.find(i => i.requestId === question.id);
          if (item?.questions?.length !== 1) throw new Error("Multiple T3 questions are pending; answer them in the T3 server thread");
          await dispatch({ type: "runtime-request.respond", requestId: question.id,
            answers: { [item.questions[0]!.id]: message.message.content } });
          return;
        }
        const run = activeRun();
        await dispatch({ type: "message.dispatch", messageId: randomUUID(), text: message.message.content, attachments: [],
          dispatchMode: run ? { type: "steer_active", targetRunId: run.id } : { type: "start_immediately" } });
      } else if (message.type === "control_response") {
        const response = message.response;
        try {
          await dispatch({ type: "runtime-request.respond", requestId: response.request_id,
            decision: response.response.behavior === "allow" ? "accept" : "decline" });
        } catch (error) { requests.delete(response.request_id); throw error; }
        emit({ type: "control_resolved", request_id: response.request_id });
      }
    }).catch(error => { emit({ type: "error", error: error instanceof Error ? error.message : "T3 control failed" }); });
  });
  try {
    // Replaying a launch command is idempotent, including a lost success reply.
    for (;;) {
      try { projection = (await launchT3Task(client, config, task)).projection; break; }
      catch (error) {
        if (!(error instanceof T3UnavailableError)) throw error;
        emit({ type: "error", error: "T3 connection interrupted during launch; retrying the same task" });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    emit({ type: "system", message: `T3 server thread ${threadId}` });
    const seen = new Map<string,string>();
    let failures = 0;
    for (;;) {
      await controls;
      const observedControls = controls;
      try { projection = await client.projection(threadId); failures = 0; }
      catch {
        // A transient server restart doesn't turn live work into a false completion.
        if (++failures === 1) emit({ type: "error", error: "T3 connection interrupted; retaining the run and retrying" });
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      // Input accepted while observation was in flight must be reflected before completion.
      if (controls !== observedControls) { await controls; continue; }
      for (const item of projection.turnItems) {
        if (item.type === "user_message") continue;
        const text = item.text ?? item.failure?.message ?? item.output ?? item.prompt ?? item.questions?.map(q => q.question).join("\n") ?? item.title;
        if (!text) continue;
        const previous = seen.get(item.id) ?? "";
        if (text !== previous) {
          emit({ type: item.type === "error" ? "error" : "assistant", message: text.startsWith(previous) ? text.slice(previous.length) : text });
          seen.set(item.id, text);
        }
      }
      for (const request of projection.runtimeRequests) {
        if (request.status !== "pending") {
          if (requests.delete(request.id)) emit({ type: "control_resolved", request_id: request.id });
          continue;
        }
        if (requests.has(request.id)) continue;
        requests.add(request.id);
        const item = projection.turnItems.find(i => i.requestId === request.id);
        if (request.kind === "user_input") {
          emit({ type: "assistant", message: "T3 is waiting for your answer. Send it as a follow-up message." });
          continue;
        }
        if (!["command", "file-read", "file-change", "permission", "mcp-elicitation"].includes(request.kind)) {
          emit({ type: "error", error: `T3 requires ${request.kind}; resolve it in the T3 server thread` });
          continue;
        }
        emit({ type: "control_request", request_id: request.id,
          request: { subtype: "can_use_tool", tool_name: request.kind, input: item ?? { kind: request.kind } } });
      }
      if (stopping && activeRun()) {
        try { await interrupt(); }
        catch { emit({ type: "error", error: "T3 stop not yet acknowledged; retrying" }); }
      }
      const latest = [...projection.runs].sort((a,b) => b.ordinal-a.ordinal)[0];
      if (latest && projection.runs.every(r => terminal.has(r.status))) {
        if (latest.status !== "completed" && !stopping) throw new Error(`T3 run ${latest.status}`);
        emit({ type: "result", result: stopping ? "T3 run interrupted" : "T3 run completed" });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { input.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(process.env.BOB_T3_CONFIG ?? "null") as T3Config;
  const task = JSON.parse(process.env.BOB_T3_TASK ?? "null") as T3Task;
  runBridge(config, task).then(() => process.exit(0), error => {
    console.error(error instanceof Error ? error.message : "T3 bridge failed");
    process.exit(1);
  });
}

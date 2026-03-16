"use client";

import { useState } from "react";

type AgentType =
  | "claude"
  | "codex"
  | "cursor-agent"
  | "gemini"
  | "kiro"
  | "opencode";

interface AgentLauncherProps {
  onLaunch: (branchName: string, agentType: AgentType) => void;
  disabled?: boolean;
}

export function AgentLauncher({ onLaunch, disabled }: AgentLauncherProps) {
  const [branchName, setBranchName] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("opencode");

  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-white">
            Create a worktree
          </div>
          <div className="mt-1 text-sm text-white/55">
            Start an agent instance immediately after creating the branch.
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
        <input
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="feature/project-scoped-controls"
          className="rounded-2xl border border-white/10 bg-[#07101b] px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/50"
        />
        <select
          value={agentType}
          onChange={(e) => setAgentType(e.target.value as AgentType)}
          className="rounded-2xl border border-white/10 bg-[#07101b] px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/50"
        >
          <option value="opencode">OpenCode</option>
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
          <option value="kiro">Kiro</option>
          <option value="cursor-agent">Cursor Agent</option>
        </select>
        <button
          type="button"
          className="rounded-2xl bg-sky-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-500"
          onClick={() => {
            onLaunch(branchName.trim(), agentType);
            setBranchName("");
          }}
          disabled={disabled || branchName.trim().length === 0}
        >
          Create
        </button>
      </div>
    </div>
  );
}

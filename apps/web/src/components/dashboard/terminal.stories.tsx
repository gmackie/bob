import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "App/Terminal",
};

export default meta;

function TerminalDemo() {
  return (
    <div className="w-[640px] rounded-xl border border-[#2E2D2A] bg-[#0E0D0B] overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-[#2E2D2A] bg-[#1C1B18] px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-[#EF5350]" />
          <div className="size-2.5 rounded-full bg-[#E8A33C]" />
          <div className="size-2.5 rounded-full bg-[#4CAF50]" />
        </div>
        <span className="ml-2 font-mono text-xs text-[#6E6B64]">bob — workspace: api-refactor</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="font-mono text-[10px] text-[#6E6B64]">connected</span>
        </div>
      </div>
      {/* Terminal body */}
      <div className="p-4 font-mono text-[13px] leading-7 text-[#EEEDEA]">
        <div><span className="text-[#E8A33C]">bob $</span> task run migrate-db-schema <span className="text-[#90CAF9]">--env</span> staging</div>
        <div><span className="text-[#6E6B64]"># Preparing execution environment...</span></div>
        <div><span className="text-[#6E6B64]"># Worktree created at /tmp/bob-wt-a3f2</span></div>
        <div>Running migration: <span className="text-[#A5D6A7]">add_work_item_priority_column</span></div>
        <div>Applied 1 migration in <span className="text-[#4CAF50]">2.3s</span></div>
        <div>&nbsp;</div>
        <div><span className="text-[#E8A33C]">bob $</span> task run test-auth-flow <span className="text-[#90CAF9]">--verbose</span></div>
        <div><span className="text-[#6E6B64]"># Running 14 test cases...</span></div>
        <div><span className="text-[#4CAF50]">PASS</span> auth/login.test.ts (0.8s)</div>
        <div><span className="text-[#4CAF50]">PASS</span> auth/refresh.test.ts (1.2s)</div>
        <div><span className="text-[#EF5350]">FAIL</span> auth/logout.test.ts (0.3s)</div>
        <div>&nbsp;</div>
        <div>  <span className="text-[#EF5350]">Expected: session.destroy() to be called</span></div>
        <div>  <span className="text-[#EF5350]">Received: 0 calls</span></div>
        <div>&nbsp;</div>
        <div>Tests: <span className="text-[#4CAF50]">12 passed</span>, <span className="text-[#EF5350]">2 failed</span>, 14 total</div>
        <div>Time: 2.3s</div>
        <div><span className="text-[#E8A33C]">bob $</span> <span className="opacity-40">_</span></div>
      </div>
    </div>
  );
}

function TerminalMinimalDemo() {
  return (
    <div className="w-[640px] rounded-xl border border-[#2E2D2A] bg-[#0E0D0B] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[#2E2D2A] bg-[#1C1B18] px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-[#EF5350]" />
          <div className="size-2.5 rounded-full bg-[#E8A33C]" />
          <div className="size-2.5 rounded-full bg-[#4CAF50]" />
        </div>
        <span className="ml-2 font-mono text-xs text-[#6E6B64]">bob — new session</span>
      </div>
      <div className="p-4 font-mono text-[13px] leading-7 text-[#EEEDEA]">
        <div><span className="text-[#E8A33C]">bob $</span> <span className="opacity-40">_</span></div>
      </div>
    </div>
  );
}

export const Default: StoryObj = {
  render: () => <TerminalDemo />,
};

export const Empty: StoryObj = {
  render: () => <TerminalMinimalDemo />,
};

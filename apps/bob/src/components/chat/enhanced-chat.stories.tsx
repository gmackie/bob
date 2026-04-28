import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";

const meta: Meta = {
  title: "Lifecycle/Enhanced Chat",
};

export default meta;

/* ─── Shared components ─── */

function ChatBubble({ role, children, time }: {
  role: "user" | "assistant" | "system";
  children: React.ReactNode;
  time: string;
}) {
  return (
    <div className={cn(
      "px-5 py-4",
      role === "assistant" ? "bg-accent/50" : "",
      role === "system" ? "bg-primary/5 border-l-2 border-primary" : "",
    )}>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn(
          "text-xs font-medium",
          role === "assistant" ? "text-primary" : role === "system" ? "text-muted-foreground" : "text-foreground",
        )}>
          {role === "user" ? "You" : role === "assistant" ? "Bob" : "System"}
        </span>
        <span className="text-[10px] text-muted-foreground">{time}</span>
      </div>
      <div className="text-sm text-secondary-foreground leading-relaxed">{children}</div>
    </div>
  );
}

function ToolCallBlock({ tool, server, status, duration, input, output, collapsed = false }: {
  tool: string;
  server?: string;
  status: "running" | "complete" | "error";
  duration?: string;
  input?: string;
  output?: string;
  collapsed?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border my-2 overflow-hidden",
      status === "running" ? "border-blue-400/30 bg-blue-500/5"
        : status === "error" ? "border-rose-400/30 bg-rose-500/5"
        : "border-border bg-card",
    )}>
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer">
        <span className={cn(
          "size-2 rounded-full",
          status === "running" ? "bg-blue-400 animate-pulse"
            : status === "error" ? "bg-rose-400"
            : "bg-emerald-400",
        )} />
        <span className="font-mono text-xs text-foreground">{tool}</span>
        {server && (
          <Badge variant="slate" className="text-[9px] px-1.5 py-0">{server}</Badge>
        )}
        {duration && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{duration}</span>
        )}
        <span className="text-muted-foreground text-xs">{collapsed ? "▶" : "▼"}</span>
      </div>
      {!collapsed && (
        <>
          {input && (
            <div className="border-t border-border/50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Input</div>
              <pre className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">{input}</pre>
            </div>
          )}
          {output && (
            <div className="border-t border-border/50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Output</div>
              <pre className="font-mono text-[11px] text-secondary-foreground whitespace-pre-wrap overflow-x-auto">{output}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ImageMessage({ src, alt, caption }: { src?: string; alt: string; caption?: string }) {
  return (
    <div className="my-2">
      <div className="rounded-xl border border-border overflow-hidden bg-secondary">
        {/* Placeholder for actual image */}
        <div className="aspect-video bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl mb-2">🖼️</div>
            <div className="text-xs text-muted-foreground">{alt}</div>
          </div>
        </div>
      </div>
      {caption && (
        <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   1. MCP TOOL CALLS IN CHAT
   ════════════════════════════════════════════════════════════════ */

export const MCPToolCalls: StoryObj = {
  name: "1. MCP Tool Calls",
  render: () => (
    <div className="w-[520px] border border-border rounded-xl bg-popover overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-foreground">Task: WI-0043</span>
        </div>
        <Badge variant="blue" className="text-[10px]">3 tool calls</Badge>
      </div>

      {/* Messages */}
      <div className="max-h-[600px] overflow-y-auto">
        <ChatBubble role="user" time="2:14 PM">
          Build the priority badge component. Use the existing badge variants from @bob/ui.
        </ChatBubble>

        <ChatBubble role="assistant" time="2:14 PM">
          I'll create the PriorityBadge component. Let me first check the existing badge implementation and color system.

          <ToolCallBlock
            tool="read_file"
            status="complete"
            duration="45ms"
            input="packages/ui/src/badge.tsx"
            output={`export const badgeVariants = cva(
  "inline-flex items-center rounded-full...",
  { variants: { variant: {
    default, slate, blue, amber, purple,
    emerald, rose, orange
  }}}
);`}
          />

          <ToolCallBlock
            tool="read_file"
            status="complete"
            duration="32ms"
            input="apps/web/src/lib/design/colors.ts"
            output={`export const PRIORITY_COLOR = {
  urgent: "rose", high: "orange",
  medium: "amber", low: "blue", none: "slate"
};`}
          />

          Good — the color mapping already exists. Now let me create the component.

          <ToolCallBlock
            tool="write_file"
            status="complete"
            duration="18ms"
            input="packages/ui/src/priority-badge.tsx"
            output="File created (47 lines)"
          />

          Created the PriorityBadge component with 5 variants matching the existing color system. Let me verify it compiles.

          <ToolCallBlock
            tool="run_command"
            status="complete"
            duration="19.1s"
            input="pnpm typecheck"
            output="Tasks: 38 successful, 38 total"
          />
        </ChatBubble>

        <ChatBubble role="system" time="2:15 PM">
          Task completed — 4 tool calls, 47 lines added, typecheck passing.
        </ChatBubble>
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <input readOnly placeholder="Type a message..." className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          <button className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Send</button>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   2. MCP SERVER INTEGRATIONS
   ════════════════════════════════════════════════════════════════ */

export const MCPServers: StoryObj = {
  name: "2. MCP Server Integrations",
  render: () => (
    <div className="w-[520px] border border-border rounded-xl bg-popover overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-foreground">Unity Game Session</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="purple" className="text-[9px]">unity-mcp</Badge>
          <Badge variant="blue" className="text-[9px]">browse</Badge>
          <Badge variant="amber" className="text-[9px]">gitea</Badge>
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto">
        <ChatBubble role="user" time="3:22 PM">
          The player character is clipping through walls. Fix the collision detection.
        </ChatBubble>

        <ChatBubble role="assistant" time="3:22 PM">
          Let me inspect the current collision setup in Unity and capture the scene view.

          <ToolCallBlock
            tool="unity.get_scene_hierarchy"
            server="unity-mcp"
            status="complete"
            duration="120ms"
            input='scene: "Level1"'
            output={`Player (Rigidbody2D, BoxCollider2D)
├── Sprite
└── GroundCheck
Tilemap_Walls (TilemapCollider2D)
Tilemap_Ground (TilemapCollider2D)`}
          />

          <ToolCallBlock
            tool="unity.get_component"
            server="unity-mcp"
            status="complete"
            duration="85ms"
            input='object: "Player", component: "Rigidbody2D"'
            output={`bodyType: Dynamic
collisionDetection: Discrete  ← problem
interpolation: None
gravityScale: 3.0`}
          />

          Found it — collision detection is set to <strong>Discrete</strong> instead of <strong>Continuous</strong>. At high velocities, the player passes through thin colliders between frames.

          <ToolCallBlock
            tool="unity.set_property"
            server="unity-mcp"
            status="complete"
            duration="45ms"
            input={`object: "Player"
component: "Rigidbody2D"
property: "collisionDetectionMode"
value: "Continuous"`}
            output="Property set successfully"
          />

          <ToolCallBlock
            tool="screenshot"
            server="screen-capture"
            status="complete"
            duration="230ms"
            input='target: "Unity Editor — Game View"'
            output="Captured 1920x1080 → /tmp/capture-001.png"
          />

          <ImageMessage alt="Unity Game View — player near wall" caption="After fix: player collides correctly with tilemap walls" />

          Fixed. Changed Rigidbody2D collision detection from Discrete to Continuous. The player should no longer clip through walls at any speed.
        </ChatBubble>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   3. IMAGE ATTACHMENTS
   ════════════════════════════════════════════════════════════════ */

export const ImageAttachments: StoryObj = {
  name: "3. Image Attachments",
  render: () => (
    <div className="w-[520px] border border-border rounded-xl bg-popover overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-foreground">UI Review Session</span>
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto">
        <ChatBubble role="user" time="4:10 PM">
          <span>Here's the current state of the dashboard. The spacing feels off and the cards look too uniform.</span>
          <ImageMessage alt="Dashboard screenshot — user uploaded" caption="Current dashboard state (uploaded by user)" />
        </ChatBubble>

        <ChatBubble role="assistant" time="4:10 PM">
          I can see a few issues:

          1. **Card spacing** — The gap between project cards is too tight (12px). Should be 24px for visual breathing room.
          2. **Hierarchy** — All cards use the same visual weight. The active project should be more prominent.
          3. **Stats row** — The metric numbers are the same size as their labels, killing the hierarchy.

          Let me fix these and capture the result.

          <ToolCallBlock
            tool="edit_file"
            status="complete"
            duration="22ms"
            input="apps/web/src/app/(dashboard)/page.tsx"
            output="3 edits applied"
          />

          <ToolCallBlock
            tool="screenshot"
            server="screen-capture"
            status="complete"
            duration="180ms"
            input='target: "Browser — localhost:3000"'
            output="Captured 1440x900 → /tmp/capture-002.png"
          />

          <ImageMessage alt="Dashboard — after spacing fix" caption="After: increased card gap, prominent active project, larger stat numbers" />

          Better? The active project card now has a subtle primary border, stats use the display font at 32px, and the card grid has proper 24px gaps.
        </ChatBubble>

        <ChatBubble role="user" time="4:12 PM">
          Much better. Can you also make the stat decrease show in red?
        </ChatBubble>
      </div>

      {/* Input with image attach */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Attach image">
            <svg className="size-4" viewBox="0 0 15 15" fill="currentColor"><path d="M2.5 1h10A1.5 1.5 0 0 1 14 2.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 1 12.5v-10A1.5 1.5 0 0 1 2.5 1Zm0 1a.5.5 0 0 0-.5.5v7.793l2.146-2.147a.5.5 0 0 1 .708 0L7.5 10.793l2.146-2.147a.5.5 0 0 1 .708 0L13 11.293V2.5a.5.5 0 0 0-.5-.5h-10ZM13 12.707l-2.646-2.647L8.207 12.207a.5.5 0 0 1-.707 0L4.854 9.56 2 12.414V12.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-.293ZM5.5 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" /></svg>
          </button>
          <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Screen capture">
            <svg className="size-4" viewBox="0 0 15 15" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h10A1.5 1.5 0 0 1 14 2.5v6A1.5 1.5 0 0 1 12.5 10h-10A1.5 1.5 0 0 1 1 8.5v-6Zm1.5-.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5h-10ZM4 12.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5Z" /></svg>
          </button>
          <input readOnly placeholder="Type a message..." className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          <button className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Send</button>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   4. SCREEN CAPTURE PANEL
   ════════════════════════════════════════════════════════════════ */

export const ScreenCapturePanel: StoryObj = {
  name: "4. Screen Capture Panel",
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex h-[640px] overflow-hidden bg-background rounded-xl border border-border">
      {/* Main content — captured window */}
      <div className="flex-1 flex flex-col border-r border-border">
        {/* Capture toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">Screen Capture</span>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Capture target selector */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-xs">
              <span className="text-muted-foreground">Target:</span>
              <select className="bg-transparent text-foreground text-xs outline-none">
                <option>Love2D — Game Window</option>
                <option>Browser — localhost:3000</option>
                <option>Unity Editor — Game View</option>
                <option>Terminal — bob agent</option>
              </select>
            </div>
            <Button variant="outline" size="sm" className="text-xs h-7">
              Capture Now
            </Button>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Auto:</span>
              <select className="bg-transparent text-foreground text-xs outline-none">
                <option>Off</option>
                <option>5s</option>
                <option selected>10s</option>
                <option>30s</option>
              </select>
            </div>
          </div>
        </div>

        {/* Captured content */}
        <div className="flex-1 bg-[#1a1a2e] flex items-center justify-center relative">
          {/* Game window placeholder */}
          <div className="w-[640px] h-[480px] bg-gradient-to-b from-[#0f0c29] via-[#302b63] to-[#24243e] rounded-lg border border-[#444] flex items-center justify-center relative overflow-hidden">
            {/* Fake game content */}
            <div className="absolute bottom-[120px] left-[200px] w-8 h-12 bg-emerald-400 rounded-sm" /> {/* Player */}
            <div className="absolute bottom-[100px] left-0 right-0 h-[100px] bg-[#2d2d2d]" /> {/* Ground */}
            <div className="absolute bottom-[100px] left-[350px] w-[60px] h-[80px] bg-[#3d3d3d]" /> {/* Wall */}
            <div className="absolute top-4 left-4 font-mono text-xs text-white/60">
              Love2D — Platformer Demo
            </div>
            <div className="absolute top-4 right-4 font-mono text-[10px] text-white/40">
              FPS: 60 · Frame: 4,847
            </div>
          </div>

          {/* Capture indicator */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 rounded-full px-2 py-1">
            <span className="size-1.5 rounded-full bg-rose-400 animate-pulse" />
            <span className="font-mono text-[10px] text-white/80">REC</span>
          </div>

          {/* Capture history strip */}
          <div className="absolute bottom-3 left-3 right-3 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={cn(
                "w-16 h-10 rounded border bg-[#0f0c29]/80 flex items-center justify-center cursor-pointer transition",
                i === 4 ? "border-primary" : "border-white/10 hover:border-white/30",
              )}>
                <span className="font-mono text-[8px] text-white/40">#{i}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat panel */}
      <div className="w-[380px] flex flex-col bg-popover">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium text-foreground">Game Dev Session</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ChatBubble role="user" time="5:01 PM">
            The player doesn't stop when hitting the wall on the right. They slide through.
          </ChatBubble>

          <ChatBubble role="assistant" time="5:01 PM">
            I can see the issue in the capture. Let me check the collision handling in your Love2D code.

            <ToolCallBlock
              tool="read_file"
              status="complete"
              duration="12ms"
              input="src/player.lua"
              output={`function Player:update(dt)
  -- movement
  self.x = self.x + self.vx * dt
  -- missing: collision response
end`}
              collapsed
            />

            The collision response is missing — the player position updates without checking for wall overlap. Let me add it.

            <ToolCallBlock
              tool="edit_file"
              status="complete"
              duration="15ms"
              input="src/player.lua:14-18"
              output="Added collision check (5 lines)"
              collapsed
            />

            <ToolCallBlock
              tool="screenshot"
              server="screen-capture"
              status="complete"
              duration="180ms"
              input='capture: "Love2D — Game Window"'
              output="Captured frame #4848"
              collapsed
            />

            Fixed. Player now stops at wall boundaries. The capture shows the character correctly blocked by the wall tile.
          </ChatBubble>
        </div>

        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <button className="rounded p-1 text-muted-foreground hover:bg-accent" title="Attach image">📎</button>
            <button className="rounded p-1 text-muted-foreground hover:bg-accent" title="Capture screen">📷</button>
            <input readOnly placeholder="Describe the issue..." className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            <button className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Send</button>
          </div>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   5. ITERATIVE VISUAL LOOP
   ════════════════════════════════════════════════════════════════ */

export const IterativeVisualLoop: StoryObj = {
  name: "5. Iterative Visual Loop",
  parameters: { layout: "padded" },
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Visual Feedback Loop</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bob captures the screen, analyzes the visual state, makes code changes, and verifies the result — all in a continuous loop.
        </p>
      </div>

      {/* Loop visualization */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              step: "1", label: "CAPTURE", title: "See the screen",
              desc: "Bob captures the target window — browser, game engine, terminal, or any app.",
              icon: "📷",
              active: false,
            },
            {
              step: "2", label: "ANALYZE", title: "Understand the state",
              desc: "Vision model analyzes the capture — identifies UI elements, errors, visual issues.",
              icon: "🔍",
              active: true,
            },
            {
              step: "3", label: "ACT", title: "Make changes",
              desc: "Bob edits code, calls MCP tools, runs commands to fix what it found.",
              icon: "⚡",
              active: false,
            },
            {
              step: "4", label: "VERIFY", title: "Check the result",
              desc: "New capture confirms the fix. If not right, loop back to step 2.",
              icon: "✅",
              active: false,
            },
          ].map((s) => (
            <div key={s.step} className={cn(
              "rounded-xl border p-4 text-center",
              s.active ? "border-primary/30 bg-primary/5" : "border-border",
            )}>
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-sm font-medium text-foreground">{s.title}</div>
              <div className="mt-2 text-xs text-muted-foreground leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Loop arrow */}
        <div className="flex justify-center mt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>← Repeat until correct →</span>
          </div>
        </div>
      </div>

      {/* Supported targets */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">Capture Targets</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: "Browser", desc: "localhost dev server, staging, any URL", mcp: "screen-capture", status: "connected" },
            { name: "Love2D", desc: "Native game window, real-time capture", mcp: "screen-capture", status: "connected" },
            { name: "Unity Editor", desc: "Game View, Scene View, Inspector", mcp: "unity-mcp", status: "connected" },
            { name: "Terminal", desc: "Any terminal window or PTY session", mcp: "built-in", status: "connected" },
            { name: "Godot Editor", desc: "2D/3D viewport, node inspector", mcp: "godot-mcp", status: "available" },
            { name: "Figma", desc: "Design frames, prototype previews", mcp: "figma-mcp", status: "available" },
          ].map((target) => (
            <div key={target.name} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">{target.name}</div>
                <div className="text-xs text-muted-foreground">{target.desc}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={target.status === "connected" ? "emerald" : "slate"} className="text-[9px]">
                  {target.status}
                </Badge>
                <span className="font-mono text-[9px] text-muted-foreground">{target.mcp}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Example iteration history */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">Iteration History — Love2D Collision Fix</h3>
        <div className="space-y-3">
          {[
            { iter: 1, action: "Captured game window — player clipping through wall", result: "Identified missing collision response in player.lua", captures: 1 },
            { iter: 2, action: "Added wall collision check to Player:update()", result: "Player stops at wall but bounces erratically", captures: 1 },
            { iter: 3, action: "Changed collision from elastic to inelastic response", result: "Clean wall stop, no bouncing. Verified with capture.", captures: 2 },
          ].map((i) => (
            <div key={i.iter} className="flex gap-3 rounded-lg border border-border bg-accent px-4 py-3">
              <div className={cn(
                "size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                i.iter === 3 ? "bg-emerald-500/20 text-emerald-400" : "bg-secondary text-muted-foreground",
              )}>
                {i.iter === 3 ? "✓" : i.iter}
              </div>
              <div className="flex-1">
                <div className="text-sm text-foreground">{i.action}</div>
                <div className="text-xs text-muted-foreground mt-1">{i.result}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-mono text-[10px] text-muted-foreground">{i.captures} capture{i.captures > 1 ? "s" : ""}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};

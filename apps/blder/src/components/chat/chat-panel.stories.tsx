import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "App/Chat Panel",
};

export default meta;

function ChatMessage({ role, content, time }: { role: "user" | "assistant"; content: string; time: string }) {
  return (
    <div className={`px-4 py-3 ${role === "assistant" ? "bg-accent/50" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">
          {role === "user" ? "You" : "Bob"}
        </span>
        <span className="text-[10px] text-muted-foreground">{time}</span>
      </div>
      <div className="text-sm text-secondary-foreground leading-relaxed">{content}</div>
    </div>
  );
}

function ChatPanelDemo({ status = "connected", title = "Planning Session" }: { status?: string; title?: string }) {
  return (
    <div className="flex flex-col border border-border bg-popover rounded-xl w-[420px] h-[500px]">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <div className={`size-2 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "error" ? "bg-rose-500" : "bg-muted-foreground"}`} />
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <svg className="size-3.5" viewBox="0 0 15 15" fill="currentColor"><path d="M3.5 2a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8Z" /></svg>
          </button>
          <button className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <svg className="size-3.5" viewBox="0 0 15 15" fill="currentColor"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" /></svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <ChatMessage role="user" content="Plan the migration for work item priorities" time="2:14 PM" />
        <ChatMessage role="assistant" content="I'll create a plan for adding priority support to work items. This involves a database migration, tRPC router updates, and UI changes. Let me break this down into tasks." time="2:14 PM" />
        <ChatMessage role="user" content="Include the board view changes too" time="2:15 PM" />
        <ChatMessage role="assistant" content="Updated the plan to include kanban board priority indicators — left-border colors and filtering. I've drafted 7 tasks total. Want me to dispatch them?" time="2:15 PM" />
      </div>

      {/* Draft panel */}
      <div className="border-t border-border px-3 py-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Draft Tasks
        </div>
        <div className="space-y-1">
          {["Add priority column migration", "Update tRPC router", "Priority badge component", "Board priority indicators"].map((t, i) => (
            <div key={i} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-secondary-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground/50" />
              {t}
            </div>
          ))}
          <div className="text-[10px] text-muted-foreground mt-1">+3 more tasks</div>
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <input
            readOnly
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Send</button>
        </div>
      </div>
    </div>
  );
}

export const Connected: StoryObj = {
  render: () => <ChatPanelDemo />,
};

export const Disconnected: StoryObj = {
  render: () => <ChatPanelDemo status="disconnected" title="Session e4a2f103" />,
};

export const Error: StoryObj = {
  render: () => <ChatPanelDemo status="error" title="Session — Error" />,
};

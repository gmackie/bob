import { killProcessTree } from "./process-tree.js";

type Child = Parameters<typeof killProcessTree>[0];
/** Cancellation exists before asynchronous workspace/provider setup begins. */
export class SessionControl {
  private readonly controller = new AbortController();
  private child?: Child;
  private escalation?: ReturnType<typeof setTimeout>;
  readonly done: Promise<void>;
  private finish!: () => void;
  constructor(private readonly kill = killProcessTree) {
    this.done = new Promise((r) => {
      this.finish = r;
    });
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  attach(child: Child): void {
    this.child = child;
    if (this.signal.aborted) this.terminate();
  }
  stop(): void {
    this.controller.abort();
    this.terminate();
  }
  private terminate(): void {
    if (!this.child || this.escalation) return;
    const child = this.child;
    this.kill(child, "SIGTERM");
    this.escalation = setTimeout(() => {
      this.kill(child, "SIGKILL");
    }, 5000);
  }
  /** Called on the process close event, never on successful signal delivery. */
  closed(): void {
    if (this.child && this.signal.aborted) this.kill(this.child, "SIGKILL");
    if (this.escalation) clearTimeout(this.escalation);
    this.escalation = undefined;
    this.child = undefined;
  }
  complete(): void {
    this.closed();
    this.finish();
  }
}

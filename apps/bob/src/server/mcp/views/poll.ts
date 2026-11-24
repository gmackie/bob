import { toolData, type CallToolResult, type ViewBridge } from "./bridge";

/** Resource-only panels fetch on mount. A tool-opened view can use the host's first result. */
export function pollTool<T>(options: {
  bridge: ViewBridge;
  name: string;
  args: () => Record<string, unknown>;
  matches: (data: T) => boolean;
  render: (data: T) => void;
  error: (message: string) => void;
  seconds: (data: T) => number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let received = false;
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), ms);
  };
  function show(result: CallToolResult) {
    const value = toolData<T>(result);
    if (!options.matches(value)) return false;
    options.render(value);
    received = true;
    schedule(options.seconds(value) * 1000);
    return true;
  }
  function fail(cause: unknown) {
    options.error(cause instanceof Error ? cause.message : String(cause));
    schedule(15_000);
  }
  async function refresh() {
    clearTimeout(timer);
    const id = ++generation;
    if (document.visibilityState === "hidden") return schedule(5000);
    try {
      const result = await options.bridge.callTool(options.name, options.args());
      if (id === generation && !show(result)) schedule(1000);
    } catch (cause) {
      if (id === generation) fail(cause);
    }
  }
  options.bridge.onToolResult = (result) => {
    try {
      if (show(result)) ++generation;
      else void refresh();
    } catch (cause) {
      fail(cause);
    }
  };
  return {
    refresh,
    start: () => {
      if (!received && !generation) schedule(250);
    },
  };
}

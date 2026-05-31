import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBlderChildCommand } from "./server.js";

describe("resolveBlderChildCommand", () => {
  it("starts production blder without pnpm", () => {
    const command = resolveBlderChildCommand(false);

    expect(command.command).toBe(process.execPath);
    expect(command.args).toHaveLength(2);
    expect(command.args[0]).toBe(path.normalize(command.args[0]));
    expect(command.args[0]).toContain(`${path.sep}vinext${path.sep}`);
    expect(command.args[0].endsWith(path.join("dist", "cli.js"))).toBe(true);
    expect(command.args[1]).toBe("start");
  });

  it("keeps dev blder on the workspace script", () => {
    expect(resolveBlderChildCommand(true)).toEqual({
      command: "pnpm",
      args: ["--filter", "@bob/blder", "dev"],
    });
  });
});

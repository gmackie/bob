import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCreatorScaffolder } from "../creator-scaffolder";

describe("createCreatorScaffolder", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("invokes the existing manifest wizard without inheriting provider credentials", async () => {
    const templatePath = await mkdtemp(join(tmpdir(), "ooda-video-template-"));
    const projectPath = join(
      await mkdtemp(join(tmpdir(), "ooda-video-projects-")),
      "voice-ooda",
    );
    await mkdir(join(templatePath, "scripts"), { recursive: true });
    await writeFile(
      join(templatePath, "scripts", "setup.mjs"),
      `import { mkdir, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(\`--\${name}\`) + 1];
const out = value("out");
await mkdir(out, { recursive: true });
await writeFile(new URL("args.json", \`file://\${out}/\`), JSON.stringify({ args, inheritedKey: process.env.OODA_CREATOR_API_KEY ?? null }));
`,
      "utf8",
    );
    vi.stubEnv("OODA_CREATOR_API_KEY", "must-not-reach-wizard");

    await createCreatorScaffolder(templatePath)({
      projectPath,
      title: "Voice OODA",
      format: "long",
      audience: "Builders",
      promise: "A trustworthy conversation-to-work path",
      fabforgeProject: "gmackie/ooda-handheld",
    });

    const invocation = JSON.parse(
      await readFile(join(projectPath, "args.json"), "utf8"),
    ) as { args: string[]; inheritedKey: string | null };
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "--yes",
        "--out",
        projectPath,
        "--title",
        "Voice OODA",
        "--format",
        "long",
        "--project",
        "gmackie/ooda-handheld",
      ]),
    );
    expect(invocation.inheritedKey).toBeNull();
  });
});

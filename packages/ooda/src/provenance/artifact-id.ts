import { createHash } from "node:crypto";

export function generateArtifactId(content: string): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

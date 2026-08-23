/**
 * ArtifactRef is the single currency for "a document the artifact pane can
 * show". Every surface (timeline, vault browser, planning output, raw tool
 * output) maps into one of these variants before being pushed on the stack.
 */
export interface ArtifactSource {
  title: string;
  url: string;
  snippet?: string;
}

export type ArtifactRef =
  | {
      type: "research-report";
      id: string;
      title: string;
      markdown: string;
      sources?: ArtifactSource[];
      jobId?: string;
    }
  | {
      type: "agent-job";
      id: string;
      title: string;
      jobId: string;
      status?: string;
      markdown?: string;
    }
  | {
      type: "proposal";
      id: string;
      title: string;
      proposalId: string;
      status?: string;
      rationale?: string;
      markdown?: string;
    }
  | { type: "plan-output"; id: string; title: string; markdown: string; sessionId?: string }
  | {
      type: "vault-note";
      id: string;
      title: string;
      path: string;
      markdown: string;
      frontmatter?: Record<string, string>;
    }
  | { type: "diff"; id: string; title: string; content: string; filePath?: string }
  | { type: "raw-output"; id: string; title: string; content: string }
  | { type: "web"; id: string; title: string; url: string };

export type ArtifactType = ArtifactRef["type"];

const KIND_LABELS: Record<ArtifactType, string> = {
  "research-report": "Research report",
  "agent-job": "Agent job",
  proposal: "Proposal",
  "plan-output": "Plan",
  "vault-note": "Note",
  diff: "Diff",
  "raw-output": "Raw output",
  web: "Link",
};

const KIND_GLYPHS: Record<ArtifactType, string> = {
  "research-report": "📄",
  "agent-job": "🤖",
  proposal: "💡",
  "plan-output": "🗺",
  "vault-note": "📝",
  diff: "±",
  "raw-output": ">_",
  web: "🔗",
};

export function artifactKindLabel(ref: ArtifactRef): string {
  return KIND_LABELS[ref.type];
}

export function artifactGlyph(ref: ArtifactRef): string {
  return KIND_GLYPHS[ref.type];
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { createProvenanceRecord, generateArtifactId } from "@gmacko/ooda/provenance";

import { createThreadWorkspace } from "./create-thread-workspace";

export interface OutlineBundleFile {
  filePath: string;
  content: string;
}

export interface CreateOutlineBundleInput {
  storageRoot: string;
  sources: OutlineBundleFile[];
  context?: OutlineBundleFile[];
  threadSlug?: string;
  threadTitle?: string;
  now?: Date;
}

export interface CreateOutlineBundleResult {
  status: "created" | "existing";
  threadDir: string;
  outlinePath: string;
  provenancePath: string;
  sourceEventIds: string[];
}

interface ParsedCapture {
  date: string;
  eventId: string;
  eventType: string;
  visibility: string;
  title: string;
  sourceBoundary: string;
  editorialIntent: string;
  facts: string;
  videoNotes: string;
  evidence: string;
  filePath: string;
}

function parseFrontmatter(content: string): {
  fields: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { fields: {}, body: content };

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      fields[key] = typeof parsed === "string" ? parsed : rawValue;
    } catch {
      fields[key] = rawValue;
    }
  }

  return { fields, body: match[2]! };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(body: string, heading: string): string {
  const expression = new RegExp(
    `^##\\s+${escapeRegex(heading)}\\s*$\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`,
    "im",
  );
  return expression.exec(body)?.[1]?.trim() ?? "";
}

function extractEvidence(body: string): string {
  const evidencePattern = new RegExp(
    "<!-- forgegraph:evidence:start -->([\\s\\S]*?)<!-- forgegraph:evidence:end -->",
  );
  return (
    evidencePattern.exec(body)?.[1]?.trim() ??
    "- No source-linked media was attached."
  );
}

function parseCapture(source: OutlineBundleFile): ParsedCapture {
  const { fields, body } = parseFrontmatter(source.content);
  const eventId = fields.forgegraph_event_id?.trim();
  if (!eventId) {
    throw new Error(
      `ForgeGraph capture is missing forgegraph_event_id: ${source.filePath}`,
    );
  }

  const title =
    /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? basename(source.filePath, ".md");

  return {
    date: fields.date || new Date().toISOString().slice(0, 10),
    eventId,
    eventType: fields.forgegraph_event_type || "unknown",
    visibility: fields.forgegraph_source_visibility || "unknown",
    title,
    sourceBoundary: extractSection(body, "Source boundary"),
    editorialIntent: extractSection(body, "Why it caught my attention"),
    facts: extractSection(body, "Facts from ForgeGraph"),
    videoNotes: extractSection(body, "Video or demo notes"),
    evidence: extractEvidence(body),
    filePath: source.filePath,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function contextHeadingMap(context: OutlineBundleFile[]): string {
  if (context.length === 0) return "- No optional vault context selected.";

  return context
    .map((item) => {
      const headings = [...item.content.matchAll(/^#{1,3}\s+(.+)$/gm)]
        .map((match) => match[1]!.trim())
        .slice(0, 8);
      const cues =
        headings.length > 0 ? headings.join("; ") : "no headings found";
      return `- \`${item.filePath}\` — context cues: ${cues}`;
    })
    .join("\n");
}

function renderCaptureSections(
  captures: ParsedCapture[],
  field:
    | "sourceBoundary"
    | "editorialIntent"
    | "facts"
    | "videoNotes"
    | "evidence",
  fallback: string,
): string {
  return captures
    .map((capture) => {
      const value = capture[field] || fallback;
      return captures.length > 1 ? `### ${capture.title}\n\n${value}` : value;
    })
    .join("\n\n");
}

function renderOutline(args: {
  captures: ParsedCapture[];
  context: OutlineBundleFile[];
  generatedAt: Date;
}): string {
  const eventIds = args.captures.map((capture) => capture.eventId).sort();
  const sourceFiles = args.captures.map((capture) => capture.filePath);
  const contextFiles = args.context.map((item) => item.filePath);
  const title =
    args.captures.length === 1
      ? args.captures[0]!.title
      : `ForgeGraph build story: ${args.captures.length} related events`;

  return `---
type: editorial-outline
status: outline
title: ${JSON.stringify(title)}
source_event_ids: ${JSON.stringify(eventIds)}
source_capture_files: ${JSON.stringify(sourceFiles)}
context_files: ${JSON.stringify(contextFiles)}
generated_at: ${JSON.stringify(args.generatedAt.toISOString())}
human_review_required: true
final_prose_generated: false
---

# ${title}

> This is a source-linked thinking scaffold, not publishable prose. Verify private or internal facts, write the voice-bearing sections yourself, and decide whether the idea deserves to exist at all.

## Editorial intent from the capture

${renderCaptureSections(args.captures, "editorialIntent", "Add the human reason this is worth exploring.")}

## Source boundary

${renderCaptureSections(args.captures, "sourceBoundary", "> Verify every detail before sharing it publicly.")}

## Verified facts from ForgeGraph

${renderCaptureSections(args.captures, "facts", "- No factual summary was present in the capture.")}

## Story spine — prompts, not prose

1. Opening moment: What surprised, frustrated, or changed your mind?
2. Before and after: What was materially different once this shipped?
3. Hard part: Which constraint, failed assumption, or tradeoff shaped the work?
4. Meaning: Why does this matter beyond a changelog entry?
5. Honest edge: What still does not work, or what would you do differently?
6. Next move: What are you building or testing now?

## Questions only a human can answer

- What did the machine record miss about the experience of building this?
- Which opinion are you willing to defend in public?
- What detail would make this recognizably yours rather than generic product copy?
- What must stay private even if the outcome is public?
- Is the right format a build update, short observation, demo video, editorial, or nothing?

## Format cuts

- **gmacko.com build update:** one human opening, the factual change, one hard-earned lesson, evidence, and the next move.
- **Short form:** one tension, one concrete proof point, and one question worth discussing.
- **YouTube/demo:** establish the problem, show the before state, perform the changed workflow, inspect evidence, and close with what remains unresolved.
- **Substack editorial:** use this only as research material; write the argument and language yourself.

## Demo and video notes from the capture

${renderCaptureSections(args.captures, "videoNotes", "Describe the UI state, action, and narration beat to capture.")}

## Evidence and media

${renderCaptureSections(args.captures, "evidence", "- No source-linked media was attached.")}

## Optional vault context map

${contextHeadingMap(args.context)}

## Human notes

<!-- Write freely here. Automation will never replace this bundle. -->
`;
}

export async function createOutlineBundle(
  input: CreateOutlineBundleInput,
): Promise<CreateOutlineBundleResult> {
  if (input.sources.length === 0) {
    throw new Error("At least one ForgeGraph capture is required.");
  }

  const captures = input.sources.map(parseCapture);
  const sourceEventIds = captures.map((capture) => capture.eventId).sort();
  const suffix = createHash("sha256")
    .update(sourceEventIds.join("\n"))
    .digest("hex")
    .slice(0, 10);
  const threadSlug = input.threadSlug ?? "forgegraph-build-notes";
  const threadDir = join(input.storageRoot, threadSlug);

  if (!existsSync(threadDir)) {
    await createThreadWorkspace({
      storageRoot: input.storageRoot,
      slug: threadSlug,
      title: input.threadTitle ?? "ForgeGraph Build Notes",
    });
  }

  const outlinesDir = join(threadDir, "outlines");
  const sourcesDir = join(threadDir, "sources");
  mkdirSync(outlinesDir, { recursive: true });
  mkdirSync(sourcesDir, { recursive: true });

  const titleSlug = slugify(captures[0]!.title) || "forgegraph-update";
  const outlinePath = join(
    outlinesDir,
    `${captures[0]!.date}-${titleSlug}-${suffix}.md`,
  );
  const provenancePath = join(sourcesDir, `outline-${suffix}.provenance.json`);

  if (existsSync(outlinePath)) {
    return {
      status: "existing",
      threadDir,
      outlinePath,
      provenancePath,
      sourceEventIds,
    };
  }

  const content = renderOutline({
    captures,
    context: input.context ?? [],
    generatedAt: input.now ?? new Date(),
  });
  writeFileSync(outlinePath, content);

  const artifactId = generateArtifactId(content);
  const provenance = {
    ...createProvenanceRecord({
      artifactId,
      threadId: threadSlug,
      sessionId: "forgegraph-outline-sync",
      capabilityId: "forgegraph-public-content",
      operationId: "forgegraph-outline-bundle",
      sourceType: "file",
      queryOrInputRef: sourceEventIds.join(","),
      canonicalSourceRef: captures.map((capture) => capture.filePath).join(","),
    }),
    sourceEventIds,
    sourceFiles: captures.map((capture) => capture.filePath),
    contextFiles: (input.context ?? []).map((item) => item.filePath),
    generatedFinalProse: false,
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  execFileSync(
    "git",
    [
      "add",
      "--",
      relative(input.storageRoot, outlinePath),
      relative(input.storageRoot, provenancePath),
    ],
    { cwd: input.storageRoot, stdio: "pipe" },
  );
  execFileSync(
    "git",
    [
      "-c",
      "user.name=OODA",
      "-c",
      "user.email=ooda@local",
      "commit",
      "-m",
      `Outline ForgeGraph event bundle: ${suffix}`,
    ],
    { cwd: input.storageRoot, stdio: "pipe" },
  );

  return {
    status: "created",
    threadDir,
    outlinePath,
    provenancePath,
    sourceEventIds,
  };
}

import { decode, encode } from "gpt-tokenizer/model/gpt-4o";

const DEFAULT_CHUNK_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 100;

export interface ChunkInput {
  sourceId: number;
  body: string;
  contentAsOf?: Date;
}

export interface Chunk {
  sourceId: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  headingContext: string | null;
  contentAsOf: Date | null;
}

interface Block {
  text: string;
  startOffset: number;
  endOffset: number;
  heading: string | null;
}

function splitIntoBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split("\n");
  let currentHeading: string | null = null;
  let blockStart = 0;
  let blockLines: string[] = [];
  let offset = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (blockLines.length > 0) {
        const text = blockLines.join("\n");
        blocks.push({
          text,
          startOffset: blockStart,
          endOffset: blockStart + text.length,
          heading: currentHeading,
        });
      }
      currentHeading = headingMatch[2]!.trim();
      blockStart = offset;
      blockLines = [line];
    } else if (line.trim() === "" && blockLines.length > 0) {
      const text = blockLines.join("\n");
      blocks.push({
        text,
        startOffset: blockStart,
        endOffset: blockStart + text.length,
        heading: currentHeading,
      });
      blockStart = offset + line.length + 1;
      blockLines = [];
    } else {
      if (blockLines.length === 0) {
        blockStart = offset;
      }
      blockLines.push(line);
    }
    offset += line.length + 1;
  }

  if (blockLines.length > 0) {
    const text = blockLines.join("\n");
    blocks.push({
      text,
      startOffset: blockStart,
      endOffset: blockStart + text.length,
      heading: currentHeading,
    });
  }

  return blocks.filter((b) => b.text.trim().length > 0);
}

export function chunkSource(
  input: ChunkInput,
  maxTokens = DEFAULT_CHUNK_TOKENS,
  overlapTokens = DEFAULT_OVERLAP_TOKENS,
): Chunk[] {
  const blocks = splitIntoBlocks(input.body);
  if (blocks.length === 0) return [];

  const chunks: Chunk[] = [];
  let currentParts: Block[] = [];
  let currentTokens = 0;

  function flush() {
    if (currentParts.length === 0) return;
    const content = currentParts.map((b) => b.text).join("\n\n");
    const tokens = encode(content);
    chunks.push({
      sourceId: input.sourceId,
      chunkIndex: chunks.length,
      content,
      tokenCount: tokens.length,
      startOffset: currentParts[0]!.startOffset,
      endOffset: currentParts[currentParts.length - 1]!.endOffset,
      headingContext: currentParts[0]!.heading,
      contentAsOf: input.contentAsOf ?? null,
    });
  }

  for (const block of blocks) {
    const blockTokens = encode(block.text).length;

    if (blockTokens > maxTokens) {
      flush();
      currentParts = [];
      currentTokens = 0;
      const slidingChunks = slidingWindowChunk(
        block,
        input.sourceId,
        chunks.length,
        maxTokens,
        overlapTokens,
        input.contentAsOf,
      );
      chunks.push(...slidingChunks);
      continue;
    }

    if (currentTokens + blockTokens > maxTokens && currentParts.length > 0) {
      flush();
      const overlapParts: Block[] = [];
      let overlapCount = 0;
      for (let i = currentParts.length - 1; i >= 0; i--) {
        const partTokens = encode(currentParts[i]!.text).length;
        if (overlapCount + partTokens > overlapTokens) break;
        overlapParts.unshift(currentParts[i]!);
        overlapCount += partTokens;
      }
      currentParts = overlapParts;
      currentTokens = overlapCount;
    }

    currentParts.push(block);
    currentTokens += blockTokens;
  }

  flush();
  return chunks;
}

function slidingWindowChunk(
  block: Block,
  sourceId: number,
  startIndex: number,
  maxTokens: number,
  overlapTokens: number,
  contentAsOf?: Date,
): Chunk[] {
  const tokens = encode(block.text);
  const chunks: Chunk[] = [];
  let pos = 0;

  while (pos < tokens.length) {
    const end = Math.min(pos + maxTokens, tokens.length);
    const sliceTokens = tokens.slice(pos, end);
    const content = decode(sliceTokens);

    chunks.push({
      sourceId,
      chunkIndex: startIndex + chunks.length,
      content,
      tokenCount: sliceTokens.length,
      startOffset: block.startOffset,
      endOffset: block.endOffset,
      headingContext: block.heading,
      contentAsOf: contentAsOf ?? null,
    });

    if (end >= tokens.length) break;
    pos = end - overlapTokens;
  }

  return chunks;
}

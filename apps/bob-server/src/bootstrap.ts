import { Socket } from "node:net";
import type { Readable } from "node:stream";

export type BootstrapEnvelope = {
  authToken?: string;
};

/**
 * Read a single JSON envelope from a readable stream (typically an inherited
 * file-descriptor pipe from a parent process). The stream is consumed until
 * EOF; the concatenated utf-8 buffer is trimmed and JSON-parsed. An empty
 * payload yields {}.
 */
export async function readBootstrapEnvelope(
  stream: Readable,
): Promise<BootstrapEnvelope> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("bootstrap envelope must be a JSON object");
  }
  const envelope: BootstrapEnvelope = {};
  const record = parsed as Record<string, unknown>;
  if (typeof record.authToken === "string") {
    envelope.authToken = record.authToken;
  }
  return envelope;
}

/**
 * Build a Readable from an inherited file descriptor. Used when a parent
 * process passes the read end of a pipe via stdio fd 3+.
 */
export function openFdStream(fd: number): Readable {
  return new Socket({ fd, readable: true, writable: false });
}

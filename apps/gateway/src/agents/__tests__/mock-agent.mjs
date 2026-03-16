#!/usr/bin/env node
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === "session.start") {
      // Acknowledge session start
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "events.output", params: { type: "text", content: "Mock agent started" } }));
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "events.toolCall", params: { id: "tc-1", name: "read_file", args: { path: "README.md" } } }));
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "events.toolResult", params: { id: "tc-1", result: "# README content" } }));
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "events.output", params: { type: "text", content: "Done!" } }));
    }
    if (msg.method === "chat.send") {
      console.log(JSON.stringify({ jsonrpc: "2.0", method: "events.output", params: { type: "text", content: `Echo: ${msg.params?.message ?? ""}` } }));
    }
  } catch {}
});

process.on("SIGTERM", () => process.exit(0));

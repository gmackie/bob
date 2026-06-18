// Stub for node:os in Cloudflare Workers.
export function homedir(): string {
  return "/tmp";
}

export default { homedir };

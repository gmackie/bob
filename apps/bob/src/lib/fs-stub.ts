// Stub for node:fs in Cloudflare Workers.
// projectCapabilities.ts uses these but they can't work in Workers.
// Returns safe defaults (file not found, empty directory).
export function existsSync(_path: string): boolean {
  return false;
}

export function readdirSync(_path: string, _options?: any): any[] {
  return [];
}

export const promises = {
  readFile: async () => { throw new Error("fs not available in Workers"); },
  writeFile: async () => { throw new Error("fs not available in Workers"); },
  mkdir: async () => { throw new Error("fs not available in Workers"); },
  readdir: async () => [],
  stat: async () => { throw new Error("fs not available in Workers"); },
  access: async () => { throw new Error("fs not available in Workers"); },
};

export default { existsSync, readdirSync, promises };

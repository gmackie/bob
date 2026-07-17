import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodeAliases: Record<string, string> = {
  "~": path.resolve(__dirname, "src"),
  "@bob/db/client": path.resolve(__dirname, "src/lib/db-client-lazy.ts"),
  postgres: path.resolve(__dirname, "node_modules/postgres/src/index.js"),
};

const cloudflareAliases: Record<string, string> = {
  ...nodeAliases,
  postgres: "postgres",
  "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
  "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
  "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
};

export function getResolveAliases(buildTarget: "cloudflare" | "node") {
  return buildTarget === "node" ? nodeAliases : cloudflareAliases;
}

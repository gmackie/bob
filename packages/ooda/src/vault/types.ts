export interface VaultConfig {
  path: string;
  name: string;
  kind: "personal" | "research";
}

export interface VaultFile {
  relativePath: string;
  name: string;
  content: string;
  frontmatter: Record<string, unknown> | null;
}

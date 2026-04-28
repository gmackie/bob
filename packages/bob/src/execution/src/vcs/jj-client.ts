import { execSync } from "child_process";

export interface JjRevision {
  changeId: string;
  commitId: string;
  description: string;
  author: string;
  email: string;
  timestamp: string;
  isWorkingCopy: boolean;
  branches: string[];
  parents: string[];
}

export class JjClient {
  constructor(private cwd: string) {}

  isJjRepo(): boolean {
    try {
      execSync("jj root", { cwd: this.cwd, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  log(limit = 20): JjRevision[] {
    // jj log --no-graph -T with a template that outputs tab-separated fields
    const template =
      'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ description.first_line() ++ "\\t" ++ author.name() ++ "\\t" ++ author.email() ++ "\\t" ++ author.timestamp() ++ "\\t" ++ if(self.working_copies(), "true", "false") ++ "\\t" ++ branches ++ "\\t" ++ parents.map(|p| p.commit_id()).join(",") ++ "\\n"';
    try {
      const out = execSync(`jj log --no-graph -T '${template}' -n ${limit}`, {
        cwd: this.cwd,
        encoding: "utf8",
      });
      return out
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [
            changeId,
            commitId,
            description,
            author,
            email,
            timestamp,
            isWc,
            branches,
            parents,
          ] = line.split("\t");
          return {
            changeId: changeId ?? "",
            commitId: commitId ?? "",
            description: description ?? "",
            author: author ?? "",
            email: email ?? "",
            timestamp: timestamp ?? "",
            isWorkingCopy: isWc === "true",
            branches: branches ? branches.split(" ").filter(Boolean) : [],
            parents: parents ? parents.split(",").filter(Boolean) : [],
          };
        });
    } catch {
      return [];
    }
  }

  new(description?: string): string {
    const cmd = description
      ? `jj new -m "${description.replace(/"/g, '\\"')}"`
      : "jj new";
    return execSync(cmd, { cwd: this.cwd, encoding: "utf8" });
  }

  describe(description: string, revision?: string): string {
    const rev = revision ? `-r ${revision}` : "";
    return execSync(
      `jj describe ${rev} -m "${description.replace(/"/g, '\\"')}"`,
      { cwd: this.cwd, encoding: "utf8" },
    );
  }

  squash(): string {
    return execSync("jj squash", { cwd: this.cwd, encoding: "utf8" });
  }

  diff(revision?: string): string {
    const rev = revision ? `-r ${revision}` : "";
    return execSync(`jj diff ${rev}`, { cwd: this.cwd, encoding: "utf8" });
  }
}

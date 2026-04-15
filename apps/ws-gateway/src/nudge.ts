import type { IncomingMessage, ServerResponse } from "node:http";

interface NudgeBody {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  description?: string;
  identifier?: string;
  branch?: string;
  sessionType?: "execution" | "planning";
  planningContext?: Record<string, unknown>;
}

export interface NudgeConfig {
  sharedSecret: string;
  onNudge: (body: NudgeBody) => void;
}

export function createNudgeHandler(cfg: NudgeConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Auth
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${cfg.sharedSecret}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // Parse body
    const body = await readJsonBody(req);
    if (!body) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    // Validate fields
    const nudge = body as Partial<NudgeBody>;
    if (!nudge.sessionId || !nudge.workspaceId || !nudge.workingDirectory || !nudge.agentType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    cfg.onNudge(nudge as NudgeBody);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

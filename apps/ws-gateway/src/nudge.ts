import type { IncomingMessage, ServerResponse } from "node:http";

interface NudgeBody {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
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
    const { sessionId, workspaceId, workingDirectory, agentType, title } = body as Partial<NudgeBody>;
    if (!sessionId || !workspaceId || !workingDirectory || !agentType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    cfg.onNudge({ sessionId, workspaceId, workingDirectory, agentType, title });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
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

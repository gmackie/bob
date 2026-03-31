import { createHmac, timingSafeEqual } from "node:crypto";

import {
  EXECUTION_TEMPLATES,
  assertSafeTemplate,
  type ExecutionTemplate,
} from "./executionTemplates.js";

interface SecretLookupResult {
  id: string;
  handle: string;
  value: string;
  usageCount?: number;
  policy?: {
    allowedTemplates?: string[];
    redactOutput?: boolean;
    maxUses?: number | null;
    templatePolicies?: Record<
      string,
      {
        allowedArgPrefixes?: Record<string, string[]>;
      }
    >;
  };
}

interface CommandRunSpec {
  command: string[];
  env?: Record<string, string>;
  stdin?: string;
}

interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface SessionSecretBrokerConfig {
  secretLookup: (
    sessionId: string,
    handle: string,
  ) => Promise<SecretLookupResult | null>;
  runner: (spec: CommandRunSpec) => Promise<CommandRunResult>;
  recordUsage: (input: {
    secretId: string;
    sessionId: string;
    templateId: string;
    exitCode: number;
    durationMs: number;
    commandPreview: string;
  }) => Promise<void> | void;
  signingKey: string;
  templates?: Record<string, ExecutionTemplate>;
}

interface TokenPayload {
  sessionId: string;
  exp: number;
}

export class SessionSecretBroker {
  private readonly templates: Record<string, ExecutionTemplate>;

  constructor(private readonly config: SessionSecretBrokerConfig) {
    this.templates = config.templates ?? EXECUTION_TEMPLATES;
  }

  issueToken(input: { sessionId: string; ttlMs?: number }) {
    const payload: TokenPayload = {
      sessionId: input.sessionId,
      exp: Date.now() + (input.ttlMs ?? 5 * 60 * 1000),
    };
    const payloadText = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(payloadText);
    return `${payloadText}.${signature}`;
  }

  async executeTemplate(input: {
    token: string;
    handle: string;
    templateId: string;
    args: Record<string, string>;
  }) {
    const sessionId = this.verifyToken(input.token);
    const secret = await this.config.secretLookup(sessionId, input.handle);
    if (!secret) {
      throw new Error(`Unknown secret handle "${input.handle}"`);
    }

    const template = this.templates[input.templateId];
    if (!template) {
      throw new Error(`Unknown execution template "${input.templateId}"`);
    }
    assertSafeTemplate(input.templateId, template);

    const allowedTemplates = secret.policy?.allowedTemplates ?? [];
    if (allowedTemplates.length > 0 && !allowedTemplates.includes(input.templateId)) {
      throw new Error(`Template "${input.templateId}" is not allowed for this secret`);
    }

    const maxUses = secret.policy?.maxUses;
    if (
      maxUses != null &&
      maxUses >= 0 &&
      (secret.usageCount ?? 0) >= maxUses
    ) {
      throw new Error(`Secret "${input.handle}" exceeded max uses`);
    }

    const templatePolicy = secret.policy?.templatePolicies?.[input.templateId];
    const allowedArgPrefixes = templatePolicy?.allowedArgPrefixes ?? {};
    for (const [argName, prefixes] of Object.entries(allowedArgPrefixes)) {
      if (!prefixes.length) continue;
      const value = input.args[argName] ?? "";
      const matches = prefixes.some((prefix) => value.startsWith(prefix));
      if (!matches) {
        throw new Error(
          `Argument "${argName}" is not allowed for template "${input.templateId}"`,
        );
      }
    }

    const command = (template.command ?? []).map((part) =>
      this.renderPart(part, secret.value, input.args),
    );
    const env = Object.fromEntries(
      Object.entries(template.env ?? {}).map(([key, value]) => [
        key,
        this.renderPart(value, secret.value, input.args),
      ]),
    );
    const stdin = template.stdin
      ? this.renderPart(template.stdin, secret.value, input.args)
      : undefined;

    template.validateArgs?.(input.args);

    const result = await this.config.runner({
      command,
      env,
      stdin,
    });

    await this.config.recordUsage({
      secretId: secret.id,
      sessionId,
      templateId: input.templateId,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      commandPreview: command.join(" "),
    });

    const redactOutput = secret.policy?.redactOutput !== false;
    return {
      ...result,
      stdout: redactOutput ? this.redact(result.stdout, secret.value) : result.stdout,
      stderr: redactOutput ? this.redact(result.stderr, secret.value) : result.stderr,
    };
  }

  private renderPart(part: string, secretValue: string, args: Record<string, string>) {
    return part
      .replace(/\{\{secret\}\}/g, secretValue)
      .replace(/\{\{arg:([^}]+)\}\}/g, (_full, key: string) => args[key] ?? "");
  }

  private redact(text: string, secretValue: string) {
    return secretValue ? text.split(secretValue).join("***") : text;
  }

  private sign(payloadText: string) {
    return createHmac("sha256", this.config.signingKey)
      .update(payloadText)
      .digest("base64url");
  }

  private verifyToken(token: string) {
    const [payloadText, signature] = token.split(".");
    if (!payloadText || !signature) {
      throw new Error("Invalid broker token");
    }

    const expected = this.sign(payloadText);
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      throw new Error("Invalid broker token");
    }

    const payload = JSON.parse(
      Buffer.from(payloadText, "base64url").toString("utf8"),
    ) as TokenPayload;
    if (payload.exp < Date.now()) {
      throw new Error("Expired broker token");
    }

    return payload.sessionId;
  }
}

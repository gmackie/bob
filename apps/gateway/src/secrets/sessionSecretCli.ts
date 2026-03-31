interface SessionSecretCliDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

interface ParsedCliArgs {
  command: "exec";
  handle: string;
  templateId: string;
  args: Record<string, string>;
}

function parseSessionSecretCliArgs(argv: string[]): ParsedCliArgs {
  const [command, ...rest] = argv;
  if (command !== "exec") {
    throw new Error(
      'Usage: bob-session-secret exec --handle <handle> --template <template-id> [--arg key=value]',
    );
  }

  let handle = "";
  let templateId = "";
  const args: Record<string, string> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--handle") {
      handle = rest[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--template") {
      templateId = rest[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--arg") {
      const pair = rest[index + 1] ?? "";
      const [key, ...valueParts] = pair.split("=");
      if (!key || valueParts.length === 0) {
        throw new Error(`Invalid --arg value "${pair}"`);
      }
      args[key] = valueParts.join("=");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${token}"`);
  }

  if (!handle || !templateId) {
    throw new Error(
      'Usage: bob-session-secret exec --handle <handle> --template <template-id> [--arg key=value]',
    );
  }

  return {
    command,
    handle,
    templateId,
    args,
  };
}

export async function runSessionSecretCli(
  argv: string[],
  deps: SessionSecretCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    const parsed = parseSessionSecretCliArgs(argv);
    const brokerUrl = env.BOB_SECRET_BROKER_URL;
    const brokerToken = env.BOB_SECRET_BROKER_TOKEN;

    if (!brokerUrl || !brokerToken) {
      throw new Error("Session secret broker env is not configured");
    }

    const response = await fetchImpl(brokerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: brokerToken,
        handle: parsed.handle,
        templateId: parsed.templateId,
        args: parsed.args,
      }),
    });

    const result = (await response.json()) as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      error?: string;
    };

    if (!response.ok) {
      stderr(`${result.error ?? `Broker request failed (${response.status})`}\n`);
      return 1;
    }

    if (result.stdout) stdout(result.stdout);
    if (result.stderr) stderr(result.stderr);
    return result.exitCode ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`${message}\n`);
    return 1;
  }
}

const invokedAsScript =
  process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedAsScript) {
  runSessionSecretCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
import { fileURLToPath } from "node:url";

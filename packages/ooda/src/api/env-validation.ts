interface EnvIssue {
  variable: string;
  problem: string;
  cause: string;
  fix: string;
}

interface ValidationResult {
  errors: EnvIssue[];
  warnings: EnvIssue[];
}

const REQUIRED_VARS = [
  {
    name: "DATABASE_URL",
    problem: "DATABASE_URL is not set or empty.",
    cause: "Postgres connection string is required for all OODA operations.",
    fix: "Set DATABASE_URL in .env. Example: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ooda_dev. See docs/SETUP.md#database.",
  },
  {
    name: "OODA_STORAGE_ROOT",
    problem: "OODA_STORAGE_ROOT is not set or empty.",
    cause:
      "Thread workspace storage root is required for durable artifact storage.",
    fix: "Set OODA_STORAGE_ROOT in .env. Example: OODA_STORAGE_ROOT=~/.ooda/threads. See docs/SETUP.md#storage.",
  },
];

const OPTIONAL_VARS = [
  {
    name: "RESEARCH_API_URL",
    problem:
      "RESEARCH_API_URL is not set. Research view will show an error when accessed.",
    cause: "The Python FastAPI research-backend sidecar is not configured.",
    fix: "Start the research backend and set RESEARCH_API_URL=http://localhost:8000 in .env. See docs/SETUP.md#research-backend.",
  },
  {
    name: "PERSONAL_VAULT_PATH",
    problem:
      "PERSONAL_VAULT_PATH is not set. Personal vault features are disabled.",
    cause: "No local clone of the personal vault repo is configured.",
    fix: "Clone the vault repo and set PERSONAL_VAULT_PATH in .env. See docs/SETUP.md#vaults.",
  },
  {
    name: "RESEARCH_VAULT_PATH",
    problem:
      "RESEARCH_VAULT_PATH is not set. Research vault features are disabled.",
    cause: "No local clone of the research vault repo is configured.",
    fix: "Clone the vault repo and set RESEARCH_VAULT_PATH in .env. See docs/SETUP.md#vaults.",
  },
  {
    name: "PERSONAL_WEBSITE_PATH",
    problem:
      "PERSONAL_WEBSITE_PATH is not set. Publish action is disabled.",
    cause: "No local clone of the personalWebsite repo is configured.",
    fix: "Clone the repo and set PERSONAL_WEBSITE_PATH in .env. See docs/SETUP.md#publishing.",
  },
];

export function validateEnvironment(): ValidationResult {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];

  for (const v of REQUIRED_VARS) {
    const value = process.env[v.name];
    if (!value || value.trim() === "") {
      errors.push({ variable: v.name, ...v });
    }
  }

  for (const v of OPTIONAL_VARS) {
    const value = process.env[v.name];
    if (!value || value.trim() === "") {
      warnings.push({ variable: v.name, ...v });
    }
  }

  return { errors, warnings };
}

export function logValidationResult(result: ValidationResult): void {
  for (const e of result.errors) {
    console.error(
      `[ENV ERROR] ${e.problem}\n  Cause: ${e.cause}\n  Fix: ${e.fix}\n`,
    );
  }
  for (const w of result.warnings) {
    console.warn(
      `[ENV WARN] ${w.problem}\n  Cause: ${w.cause}\n  Fix: ${w.fix}\n`,
    );
  }
  if (result.errors.length > 0) {
    console.error(
      `${result.errors.length} required env var(s) missing. OODA cannot start. See .env.example.`,
    );
  }
}

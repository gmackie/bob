import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const chatRoute = join(
  dirname(fileURLToPath(import.meta.url)),
  "../page.tsx",
);

assert.equal(
  existsSync(chatRoute),
  true,
  "dashboard /chat route must exist because UI links to /chat?session=<id>",
);

import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import { divesRouter } from "./research/dives";
import { entitiesRouter } from "./research/entities";
import { graphRouter } from "./research/graph";
import { interestsRouter } from "./research/interests";
import { kbRouter } from "./research/kb";
import { memoryRouter } from "./research/memory";
import { papersRouter } from "./research/papers";
import { toolsRouter } from "./research/tools";

export const researchRouter = {
  ...kbRouter,
  ...divesRouter,
  ...memoryRouter,
  ...entitiesRouter,
  ...papersRouter,
  ...graphRouter,
  ...toolsRouter,
  ...interestsRouter,
} satisfies RouterRecord;

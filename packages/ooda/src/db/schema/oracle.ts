import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const oracleQueryLog = pgTable(
  "oracle_query_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    taskDescription: text().notNull(),
    repoContext: text(),
    question: text().notNull(),
    unitsReturned: uuid().array(),
    answerText: text(),
    confidence: real(),
    agentUsedResult: boolean(),
    feedbackScore: integer(),
    queriedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    latencyMs: integer(),
  },
  (t) => [
    index("oracle_query_log_queried_at_idx").on(t.queriedAt.desc()),
  ],
);

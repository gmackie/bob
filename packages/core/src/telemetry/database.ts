import { instrumentPostgres } from "@forgegraph/otel/postgres";
import { withTraceSpan } from "./deep";

/** Keep database children in Bob's existing Node or Worker trace context. */
export function tracePostgres<T extends object>(client: T): T {
  return instrumentPostgres(client, {
    span: (name, run, options) => withTraceSpan(name, run, {
      kind: "client",
      attributes: options.attributes,
    }),
  });
}

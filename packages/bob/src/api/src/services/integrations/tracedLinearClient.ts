import {
  captureTraceCarrier,
  withTraceSpan,
} from "@gmacko/core/telemetry/deep";
import { LinearClient } from "@linear/sdk";

/** Wrap this SDK instance's public transport, never global fetch or shared headers. */
export function createTracedLinearClient(
  options: ConstructorParameters<typeof LinearClient>[0],
): LinearClient {
  const client = new LinearClient({
    ...options,
    ...(options.apiUrl ? { redirect: "manual" } : {}),
  });
  // Only explicitly configured Linear-compatible integrations receive context.
  // Linear's SaaS default remains outside the trusted internal service boundary.
  if (!options.apiUrl) return client;
  const request = client.client.request.bind(client.client);
  client.client.request = (document, variables, requestHeaders) =>
    withTraceSpan(
      "kanbanger.graphql",
      async () => {
        const headers = new Headers(requestHeaders);
        headers.delete("baggage");
      headers.delete("tracestate");
      const carrier = captureTraceCarrier();
        if (carrier) {
          headers.set("traceparent", carrier.traceparent);
          if (carrier.tracestate) headers.set("tracestate", carrier.tracestate);
        }
        return request(document, variables, headers);
      },
      {
        kind: "client",
        attributes: {
          "peer.service": "kanbanger",
          "http.request.method": "POST",
        },
      },
    );
  return client;
}

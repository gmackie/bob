export * from "./protocol.js";
export { BobWsClient } from "./client.js";
export type { BobWsClientOptions, ConnectionState, IWebSocket, IWebSocketConstructor } from "./client.js";

// Presentation model for provider health — shared by the web dashboard,
// the mobile node list and the tablet cockpit so they cannot disagree about
// the same agent.
export * from "./provider-health.js";

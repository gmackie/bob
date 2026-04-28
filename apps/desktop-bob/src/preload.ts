// Preload runs in an isolated Node context before any renderer code. For Phase
// 2 we do not expose any custom bridges — the UI speaks to bob-server via
// normal HTTP/WS from the renderer.
export {};

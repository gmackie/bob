# t3 WebSocket RPC frame fixtures (BOB-80)

Authored by hand, strictly from `docs/plans/2026-11-15-t3-ws-protocol.html`
(t3code custom-local @ d70371393c, Effect RPC 4.1.x). They are not recordings
from a live server: recording against the hetzner-bob t3 server is still open.
Each file has `spec` (the sections it follows) and either `frames` (server →
client messages, one per WebSocket text frame unless the entry is an array) or
`expected` (a client → server message, compared without its `id`).

| File | Spec |
| --- | --- |
| `request-subscribe-thread.json` | §2.2 Request envelope (`headers` required), §3.1 payload (`requestCompletionMarker`, `acceptBoundedSnapshot`; no compact flags) |
| `request-subscribe-shell.json` | §3.2 payload (only `requestCompletionMarker`, optional `afterSequence`) |
| `request-respond.json` | §3.4 `orchestration.dispatchCommand` with `runtime-request.respond` |
| `thread-stream.json` | §2.3 Chunk/Exit, §3.1 snapshot/synchronized/event items, turn item text fields, `outputOmitted`, §3.3 `user_input_request` and runtime request, unknown event type (ignored, cursor advances) |
| `shell-stream.json` | §3.2 snapshot, enrichment-only snapshot (`resolvedRepositoryIdentityRoots`), synchronized, `thread.updated` / `thread.removed`, §3.3 `pendingRuntimeRequest` (incl. HEAD-only `userOnly`) |
| `batched-frame.json` | §2.1 an array of messages in one frame |
| `exit-success.json` | §2.3 unary Exit Success `{sequence}` |
| `exit-fail.json` | §2.3 Exit Failure with a declared `Fail` (`OrchestrationV2DispatchCommandError`) |
| `exit-die.json` | §2.3 Exit Failure with `Die` (schema decode defect) |
| `defect.json` | §2.3 socket-level Defect, §2.5 |
| `pong.json` | §2.2/§2.5 Ping → Pong |

# Bob mobile tasks on the always-on T3 server

Tracked by BOB-40 and T3CODE-5. Bob's OODA gateway runner owns task claims,
worktree preparation, run reporting and PR finalization. Configure that existing
runner with `OODA_T3CODE_SERVER_URL=http://127.0.0.1:3773` and
`OODA_T3CODE_AUTH_TOKEN` from the server's protected credential store to execute
its gateway tasks in T3. Do not start a second execution daemon in its workspace.
Without the URL, existing local adapters remain selected. A URL without a token
fails startup validation.

`OODA_T3CODE_MODEL_INSTANCE_ID` and `OODA_T3CODE_MODEL` optionally choose the
server provider/model. Otherwise the task's agent maps to a T3 provider and its
server-advertised default model; a persona model remains explicit. Task permission
mode is preserved. Tool allowlists unsupported by T3 reject the handoff rather
than broadening access. Legacy project ID/runtime-mode variables do not override
repository identity or the task's permission boundary.

The bridge uses protocol 2: bearer-authenticated websocket tickets and Effect RPC
`orchestration.launchThread`, `getThreadProjection`, and `dispatchCommand`.
Project identity is matched by repository root, and the runner-prepared worktree
is bound before execution. Stable command/thread/message IDs make launch retries
idempotent. Output and permission prompts use the supervisor's journal, allowing
adoption after runner restarts. Stop uses a control message; the bridge stays
alive until T3 reports termination. Network loss retains the worktree and retries
observation instead of reporting a false completion. Single pending input
questions accept a Bob follow-up; multiple questions and unsupported request kinds
currently need the T3 server thread and are reported explicitly.

Both services must see the same worktree path. The T3 systemd service uses
PrivateTmp, so `/tmp` is unsuitable; use the existing `/home/bob/.bob/worktrees`
location. T3 remains loopback-only.

## Codex compatibility prerequisite

On 2026-10-10 T3 `0.0.45-gmacko.202610070116` rejected installed Codex `0.135.0`
thread/start responses because `thread.projectId` was missing. T3CODE-5 installs
Codex `0.162.1` separately under `/home/bob/.local/share/t3-codex-0.162.1` and
prepends its `node_modules/.bin` directory in the T3-only systemd drop-in
`/etc/systemd/system/t3code-bob.service.d/codex-runtime.conf`. The prior system
CLI remains installed. Roll back by removing that drop-in, reloading systemd and
restarting T3 after checking for active work.

The shared-worktree probe completed with `BOB_SERVER_T3_HANDOFF_OK` in thread
`bob-7c03145b196274816db3418f00e5cb1d`; replaying the same session returned the
same completed run. This proves the server bridge boundary, not the full mobile
production flow. Keep BOB-40 open until merged runner/mobile code, TestFlight,
and a mobile task through Kanbanger/T3/ForgeGraph are verified.

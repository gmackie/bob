import { NextResponse } from "next/server";

/**
 * Previously proxied to the old gateway's /forge/register endpoint.
 * The old gateway has been removed. Forge registration now goes through
 * ForgeGraph CLI or the Go daemon.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "ForgeGraph registration is handled by the daemon/CLI path.",
      recovery: {
        unavailable:
          "Install or authenticate the ForgeGraph CLI on the daemon machine, then restart the bob daemon.",
        register:
          "Run `fg app create --path <repo-path>` on the daemon machine. Bob will link the repo after the next heartbeat reports forgeAppId.",
      },
    },
    { status: 410 },
  );
}

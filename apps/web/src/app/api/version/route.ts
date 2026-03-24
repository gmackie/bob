import { NextResponse } from "next/server";

import packageJson from "../../../../../../package.json";

export async function GET() {
  return NextResponse.json({
    version: packageJson.version,
    buildTime: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
}

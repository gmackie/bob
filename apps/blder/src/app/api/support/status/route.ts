import { NextResponse } from "next/server";

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function GET() {
  const emergencyDisabled = readBooleanEnv("BOB_EMERGENCY_DISABLED");

  return NextResponse.json({
    bugReportUrl:
      process.env.BOB_BUG_REPORT_URL ??
      process.env.NEXT_PUBLIC_BOB_BUG_REPORT_URL ??
      "https://github.com/gmackie/bob/issues/new?labels=bug",
    emergencyDisabled,
    emergencyReason: emergencyDisabled
      ? (process.env.BOB_EMERGENCY_DISABLE_REASON ??
        "Bob is temporarily disabled while the team resolves an operational issue.")
      : null,
    generatedAt: new Date().toISOString(),
    supportEmail:
      process.env.BOB_SUPPORT_EMAIL ??
      process.env.NEXT_PUBLIC_BOB_SUPPORT_EMAIL ??
      "support@blder.bot",
  });
}

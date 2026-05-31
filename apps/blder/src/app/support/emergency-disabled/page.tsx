import Link from "next/link";
import {
  ExclamationTriangleIcon,
  ExternalLinkIcon,
} from "@radix-ui/react-icons";

import { Button } from "@bob/ui/button";

function getBugReportUrl(): string {
  return (
    process.env.BOB_BUG_REPORT_URL ??
    process.env.NEXT_PUBLIC_BOB_BUG_REPORT_URL ??
    "https://github.com/gmackie/bob/issues/new?labels=bug"
  );
}

function getSupportEmail(): string {
  return (
    process.env.BOB_SUPPORT_EMAIL ??
    process.env.NEXT_PUBLIC_BOB_SUPPORT_EMAIL ??
    "support@blder.bot"
  );
}

export default function EmergencyDisabledPage() {
  const reason =
    process.env.BOB_EMERGENCY_DISABLE_REASON ??
    "Bob is temporarily disabled while the team resolves an operational issue.";

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6 py-12">
      <section className="border-border w-full max-w-xl rounded-lg border p-8">
        <ExclamationTriangleIcon className="text-primary size-6" />
        <div className="text-muted-foreground mt-5 text-xs font-semibold tracking-[0.18em] uppercase">
          Emergency disable active
        </div>
        <h1 className="font-display mt-3 text-3xl font-semibold">
          Product access is temporarily paused
        </h1>
        <p className="text-muted-foreground mt-4 text-sm leading-6">{reason}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <a href={getBugReportUrl()} target="_blank" rel="noreferrer">
              Report a bug
              <ExternalLinkIcon />
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`mailto:${getSupportEmail()}`}>Email support</a>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/api/support/status">Status JSON</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBobRpcClient } from "~/rpc/react";

type CookieDomain = {
  domain: string;
  count: number;
  source: string | null;
  lastUpdated: Date | string | null;
};

function SetupGuide() {
  const [activeTab, setActiveTab] = useState<"extension" | "cli">("extension");

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-muted/30 p-5">
        <h3 className="mb-2 text-sm font-semibold">What is the Cookie Jar?</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The Cookie Jar lets your agent sessions browse authenticated websites
          and make authenticated API requests using your real browser cookies.
          Import cookies from your browser, then grant specific domains to agent
          sessions — agents never see cookies they don&apos;t need.
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">How to import cookies</h3>
        <div className="mb-3 flex gap-1 rounded-lg border border-border/50 bg-muted/20 p-1">
          <button
            onClick={() => setActiveTab("extension")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "extension"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Browser Extension
          </button>
          <button
            onClick={() => setActiveTab("cli")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "cli"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            CLI (Local)
          </button>
        </div>

        {activeTab === "extension" && (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">
              Best for remote Bob instances. Works with Chrome and Firefox.
            </p>
            <ol className="text-muted-foreground list-inside list-decimal space-y-3 text-sm">
              <li>
                <span className="text-foreground font-medium">
                  Install the extension
                </span>
                <p className="mt-1 pl-5 text-xs">
                  Load <code className="rounded bg-muted px-1.5 py-0.5">extensions/chrome/</code> as
                  an unpacked extension in Chrome (<code className="rounded bg-muted px-1.5 py-0.5">chrome://extensions</code> {"\u2192"} Developer
                  mode {"\u2192"} Load unpacked), or <code className="rounded bg-muted px-1.5 py-0.5">extensions/firefox/</code> in Firefox.
                </p>
              </li>
              <li>
                <span className="text-foreground font-medium">
                  Configure the extension
                </span>
                <p className="mt-1 pl-5 text-xs">
                  Right-click the extension icon {"\u2192"} Options. Enter your Bob URL and
                  an API key with <code className="rounded bg-muted px-1.5 py-0.5">write</code> permission
                  (create one in the API Keys section above).
                </p>
              </li>
              <li>
                <span className="text-foreground font-medium">
                  Send cookies
                </span>
                <p className="mt-1 pl-5 text-xs">
                  Navigate to any site you want agents to access (e.g. GitHub).
                  Click the extension icon and hit &quot;Send cookies&quot;. Use the
                  Advanced toggle to pick multiple domains at once.
                </p>
              </li>
            </ol>
          </div>
        )}

        {activeTab === "cli" && (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">
              Best when Bob runs on the same machine as your browser. Reads
              cookies directly from Chromium&apos;s SQLite database (Chrome, Arc,
              Brave, Edge).
            </p>
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-xs font-medium">Set up auth:</p>
                <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
{`export BOB_URL="https://bob.example.com"
export BOB_API_KEY="gmk_..."  # API key with write permission`}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Import cookies for a domain:</p>
                <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
{`bob cookies import --domain github.com
bob cookies import --domain github.com --domain linear.app
bob cookies import --domain github.com --browser chrome`}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Manage the jar:</p>
                <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
{`bob cookies list          # show imported domains
bob cookies remove --domain github.com`}
                </pre>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              On macOS, you&apos;ll be prompted to allow Keychain access the first time.
              Click &quot;Allow&quot; when the system dialog appears.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 p-5">
        <h3 className="mb-2 text-sm font-semibold">Using cookies in agent sessions</h3>
        <p className="text-muted-foreground mb-3 text-sm leading-relaxed">
          Once cookies are imported, grant access when starting an agent session
          by specifying which domains the agent can use.
        </p>
        <ul className="text-muted-foreground space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-foreground/70 shrink-0">{"\u2022"}</span>
            <span>
              <span className="text-foreground font-medium">Session creation</span> — pass{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">cookieDomains</code> when
              starting a session to grant access to specific domains.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-foreground/70 shrink-0">{"\u2022"}</span>
            <span>
              <span className="text-foreground font-medium">Playwright</span> — the
              agent calls <code className="rounded bg-muted px-1.5 py-0.5 text-xs">get_cookies</code> to
              inject cookies into browser contexts for authenticated browsing.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-foreground/70 shrink-0">{"\u2022"}</span>
            <span>
              <span className="text-foreground font-medium">HTTP requests</span> — the
              cookie jar skill formats cookies into headers for{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">fetch</code> and{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">curl</code> calls.
            </span>
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-sm font-medium text-amber-200/80">Security</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          All cookie values are encrypted at rest with AES-256-GCM. Agents can
          only access cookies for domains explicitly granted to their session.
          Every cookie access is logged in the session event stream for full
          auditability.
        </p>
      </div>
    </div>
  );
}

function CookieTable({
  cookies,
}: {
  cookies: Array<{
    domain: string;
    count: number;
    source: string;
    lastUpdated: Date | null;
  }>;
}) {
  const rpc = useBobRpcClient();
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: (input: { domain: string }) =>
      rpc.settings.cookies.remove(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["rpc", "settings.cookies.list"],
      });
    },
  });

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground border-b border-border text-xs">
          <th className="py-2 text-left">Domain</th>
          <th className="py-2 text-left">Cookies</th>
          <th className="py-2 text-left">Source</th>
          <th className="py-2 text-left">Updated</th>
          <th className="py-2"></th>
        </tr>
      </thead>
      <tbody>
        {cookies.map((entry) => (
          <tr
            key={`${entry.domain}-${entry.source}`}
            className="border-b border-border/50"
          >
            <td className="py-2 font-mono text-xs">{entry.domain}</td>
            <td className="py-2">{entry.count}</td>
            <td className="py-2 text-muted-foreground">{entry.source}</td>
            <td className="text-muted-foreground py-2 text-xs">
              {entry.lastUpdated
                ? new Date(entry.lastUpdated).toLocaleDateString()
                : "\u2014"}
            </td>
            <td className="py-2 text-right">
              <button
                onClick={() =>
                  removeMutation.mutate({ domain: entry.domain })
                }
                disabled={removeMutation.isPending}
                className="text-destructive hover:text-destructive/80 text-xs"
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CookieJar() {
  const rpc = useBobRpcClient();

  const { data: cookies, isLoading } = useQuery(
    {
      queryKey: ["rpc", "settings.cookies.list"],
      queryFn: async () =>
        (await rpc.settings.cookies.list(undefined)) as CookieDomain[],
    },
  );

  if (isLoading) {
    return (
      <section className="rounded-lg border p-6">
        <div className="animate-pulse space-y-4">
          <div className="bg-muted h-16 rounded" />
          <div className="bg-muted h-16 rounded" />
        </div>
      </section>
    );
  }

  const cookieRows =
    cookies?.map((entry) => ({
      domain: entry.domain,
      count: entry.count,
      source:
        typeof entry.source === "string"
          ? entry.source
          : "unknown",
      lastUpdated:
        entry.lastUpdated == null
          ? null
          : new Date(entry.lastUpdated),
    })) ?? [];

  const hasCookies = cookieRows.length > 0;

  return (
    <section className="space-y-6">
      {hasCookies && (
        <div className="rounded-lg border p-6">
          <div className="text-muted-foreground mb-4 text-xs">
            Imported cookies available to agent sessions. Values are encrypted
            and never displayed.
          </div>
          <CookieTable cookies={cookieRows} />
        </div>
      )}
      <SetupGuide />
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

const CONTACT_EMAIL = "sean@reedster.llc";
const LAST_UPDATED = "May 31, 2026";

type LegalTableRow = {
  label: string;
  value: string;
  detail: string;
};

type LegalSection = {
  heading: string;
  body?: string[];
  bullets?: string[];
  table?: LegalTableRow[];
};

export type LegalDocument = {
  slug: string;
  title: string;
  summary: string;
  sections: LegalSection[];
};

const productDescription =
  "blder.bot is an AI agent management and software delivery workspace for developers and technical teams.";

export const legalDocuments = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    summary:
      "The rules for using blder.bot, including account responsibilities, acceptable use, customer content, and service limits.",
    sections: [
      {
        heading: "Agreement",
        body: [
          `These Terms govern access to and use of blder.bot. ${productDescription} By creating an account, using the web app, using the API, or connecting the bob CLI, you agree to these Terms on behalf of yourself or the organization you represent.`,
          "If you use blder.bot for an organization, you represent that you have authority to bind that organization to these Terms.",
        ],
      },
      {
        heading: "Accounts and access",
        bullets: [
          "You are responsible for keeping account credentials, API keys, device codes, and connected provider tokens secure.",
          "You must provide accurate account information and keep your Git provider and workspace connections under your control.",
          "You are responsible for activity performed through your account, including activity initiated by agents or local runtimes you connect.",
        ],
      },
      {
        heading: "Customer content",
        body: [
          "You retain ownership of repositories, work items, prompts, plans, logs, artifacts, comments, pull request metadata, imported cookies, secrets, and other content you submit to blder.bot.",
          "You grant blder.bot the limited rights needed to host, process, transmit, secure, and display that content so we can provide the service.",
        ],
      },
      {
        heading: "Agent activity",
        bullets: [
          "blder.bot can coordinate coding agents, local workspaces, terminals, plans, reviews, and deployment workflows.",
          "You are responsible for reviewing agent output before merging, deploying, or relying on it.",
          "Do not grant agents access to repositories, secrets, cookies, systems, or production environments unless you are authorized to do so.",
        ],
      },
      {
        heading: "Acceptable use",
        bullets: [
          "Do not use blder.bot to violate law, infringe rights, attack systems, bypass access controls, or process data you are not authorized to process.",
          "Do not attempt to disrupt, reverse engineer, overload, scan, or compromise blder.bot or its infrastructure except through authorized security testing.",
          "Do not upload malware, credential dumps, or sensitive regulated data unless your agreement with us expressly allows it.",
        ],
      },
      {
        heading: "Service changes and availability",
        body: [
          "We may update, suspend, or discontinue parts of the service as the product evolves. We work to preserve customer data and provide reasonable notice when changes materially affect active use.",
          "The service is provided on an as-is and as-available basis except where a separate written agreement states otherwise.",
        ],
      },
      {
        heading: "Liability",
        body: [
          "To the maximum extent permitted by law, blder.bot and its operators will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, or business interruption.",
          "Our aggregate liability for claims relating to the service is limited to the amounts paid for the service in the 12 months before the event giving rise to the claim, unless a separate written agreement says otherwise.",
        ],
      },
      {
        heading: "Contact",
        body: [`Questions about these Terms can be sent to ${CONTACT_EMAIL}.`],
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "How blder.bot collects, uses, shares, retains, and protects personal information and workspace data.",
    sections: [
      {
        heading: "Overview",
        body: [
          `${productDescription} This Privacy Policy explains how we handle information when you use the web app, API, device login flow, connected integrations, and bob CLI workflows.`,
        ],
      },
      {
        heading: "Information we collect",
        bullets: [
          "Account data such as name, email address, avatar, Git provider identity, organization membership, and authentication records.",
          "Workspace data such as projects, work items, plans, agent runs, comments, repository metadata, pull request metadata, logs, artifacts, and settings.",
          "Integration data such as Git provider tokens, ForgeGraph tokens, API keys, webhooks, device codes, and session secrets.",
          "Optional cookie jar data imported by you through the extension or CLI, including cookie names, domains, paths, expiration metadata, and encrypted values.",
          "Technical data such as IP address, user agent, request metadata, diagnostics, security logs, and service events.",
        ],
      },
      {
        heading: "How we use information",
        bullets: [
          "Provide, secure, maintain, and debug blder.bot.",
          "Authenticate users and authorize access to workspaces, repositories, runs, and APIs.",
          "Coordinate agent sessions, local runtimes, planning workflows, reviews, and artifacts.",
          "Detect abuse, troubleshoot reliability issues, and enforce service terms.",
          "Communicate about product, security, legal, and operational updates.",
        ],
      },
      {
        heading: "Sharing",
        body: [
          "We do not sell personal information. We share information with subprocessors and integrations only as needed to provide the service, comply with law, protect rights and security, or complete a business transaction subject to appropriate safeguards.",
        ],
      },
      {
        heading: "Retention",
        body: [
          "We retain account and workspace information while your account is active or as needed to provide the service. We may retain limited records longer when required for security, legal, backup, tax, accounting, or dispute purposes.",
        ],
      },
      {
        heading: "Your choices",
        bullets: [
          "You can disconnect integrations, delete imported cookies, rotate API keys, and update workspace settings in the product.",
          "You can request export or deletion of account and workspace data by contacting us.",
          "Some data may remain in backups, audit records, or third-party provider logs for a limited period after deletion.",
        ],
      },
      {
        heading: "Contact",
        body: [`Privacy requests can be sent to ${CONTACT_EMAIL}.`],
      },
    ],
  },
  dpa: {
    slug: "dpa",
    title: "Data Processing Addendum",
    summary:
      "The baseline data processing terms for customers who use blder.bot to process personal data in workspace content.",
    sections: [
      {
        heading: "Scope",
        body: [
          "This Data Processing Addendum applies when blder.bot processes personal data on behalf of a customer as a processor or service provider. It supplements the Terms unless the customer has signed a separate agreement with different data processing terms.",
        ],
      },
      {
        heading: "Processing details",
        table: [
          {
            label: "Subject matter",
            value: "AI software delivery workspace",
            detail:
              "Hosting and processing account, workspace, repository, agent run, artifact, and integration data.",
          },
          {
            label: "Duration",
            value: "Term of service use",
            detail:
              "For the customer account lifetime plus limited retention for backups, security, legal, and audit needs.",
          },
          {
            label: "Categories of data",
            value: "Account, workspace, technical, and integration data",
            detail:
              "May include names, emails, repository metadata, work content, logs, secrets metadata, and encrypted cookie metadata.",
          },
          {
            label: "Data subjects",
            value: "Customer users and people appearing in customer content",
            detail:
              "Developers, administrators, collaborators, and other individuals represented in repositories or work items.",
          },
        ],
      },
      {
        heading: "Customer instructions",
        body: [
          "We process customer personal data only to provide the service, follow documented customer instructions, comply with law, and protect the service.",
        ],
      },
      {
        heading: "Security measures",
        bullets: [
          "Encryption for sensitive token, secret, and cookie values at rest.",
          "Authentication and authorization controls for user, workspace, API key, and device flows.",
          "Scoped agent access to cookies and secrets where the product supports session scoping.",
          "Operational logging, least-privilege access expectations, and infrastructure controls provided by hosting subprocessors.",
        ],
      },
      {
        heading: "Subprocessors",
        body: [
          "We may use subprocessors listed on the Subprocessors page. We remain responsible for subprocessor performance under this DPA and will update the list when material subprocessors change.",
        ],
      },
      {
        heading: "Assistance and deletion",
        body: [
          "We will provide reasonable assistance for data subject requests, security inquiries, export, deletion, and regulatory requests where required by law and technically feasible.",
        ],
      },
      {
        heading: "Contact",
        body: [`DPA questions can be sent to ${CONTACT_EMAIL}.`],
      },
    ],
  },
  subprocessors: {
    slug: "subprocessors",
    title: "Subprocessors",
    summary:
      "Third-party services that may process customer data to help operate blder.bot.",
    sections: [
      {
        heading: "Current subprocessors",
        table: [
          {
            label: "Cloudflare",
            value: "Hosting, edge routing, security, and caching",
            detail:
              "Used to serve the blder.bot web application and API traffic.",
          },
          {
            label: "Hetzner",
            value: "Database and server infrastructure",
            detail:
              "Used for Postgres-backed application data and supporting runtime infrastructure.",
          },
          {
            label: "GitHub",
            value: "Authentication and repository integration",
            detail:
              "Used when customers sign in with GitHub or connect GitHub repositories, tokens, pull requests, and metadata.",
          },
          {
            label: "Expo",
            value: "Mobile push notifications",
            detail:
              "Used for mobile device push tokens and notification delivery when mobile notifications are enabled.",
          },
        ],
      },
      {
        heading: "Optional customer-directed services",
        body: [
          "Customers may connect additional services such as GitLab, Gitea, ForgeGraph, local agents, local runtimes, or third-party coding tools. Those services process data at the customer's direction and under the customer's relationship with that provider.",
        ],
      },
      {
        heading: "Updates",
        body: [
          "We will update this page when we add or remove material subprocessors. For questions about a subprocessor, contact us before enabling the affected integration.",
        ],
      },
    ],
  },
  security: {
    slug: "security",
    title: "Security",
    summary:
      "Security practices for blder.bot accounts, integrations, tokens, secrets, imported cookies, and agent sessions.",
    sections: [
      {
        heading: "Security model",
        body: [
          "blder.bot is designed around authenticated users, scoped workspaces, connected Git providers, API keys, device flows, local runtimes, and agent sessions. Customers control which repositories, cookies, secrets, and local systems they connect.",
        ],
      },
      {
        heading: "Sensitive data protection",
        bullets: [
          "Git provider tokens, session secrets, and imported browser cookie values are encrypted at rest using AES-256-GCM.",
          "Cookie access is scoped by domain for agent sessions, and cookie access events are logged in session streams.",
          "API key and session flows are separated so local runtimes can authenticate without sharing browser sessions.",
          "Webhook and provider tokens should be rotated if exposure is suspected.",
        ],
      },
      {
        heading: "Infrastructure",
        bullets: [
          "The public web app is deployed on Cloudflare Workers.",
          "Application data is stored in Postgres-backed infrastructure.",
          "TLS is used for production web and API traffic.",
          "Security-sensitive configuration is provided through environment variables and deployment secrets.",
        ],
      },
      {
        heading: "Customer responsibilities",
        bullets: [
          "Limit repository, cookie, secret, and deployment access to what each agent session needs.",
          "Review agent-generated code, commands, pull requests, and deployment actions before relying on them.",
          "Use strong Git provider account security and revoke provider access when it is no longer needed.",
          "Do not import cookies or secrets for domains or systems you are not authorized to access.",
        ],
      },
      {
        heading: "Reporting issues",
        body: [
          `Report suspected vulnerabilities or security incidents to ${CONTACT_EMAIL}. Include affected URLs, reproduction steps, impact, and whether any data was accessed.`,
        ],
      },
    ],
  },
  "data-deletion": {
    slug: "data-deletion",
    title: "Data Deletion and Export",
    summary:
      "How customers can export or delete blder.bot account, workspace, integration, cookie, and agent run data.",
    sections: [
      {
        heading: "Export",
        bullets: [
          "Workspace content can be exported by requesting a copy of account, project, work item, run, artifact, comment, and settings data.",
          "Repository content remains in the connected Git provider or local workspace and should be exported from that source.",
          "Agent artifacts and logs can be exported when technically available for the relevant workspace and retention period.",
        ],
      },
      {
        heading: "Deletion",
        bullets: [
          "Imported browser cookies can be removed from the Cookie Jar settings.",
          "API keys, Git provider connections, webhooks, and session secrets can be rotated, disconnected, or deleted from settings where available.",
          "Account or workspace deletion can be requested by contacting us.",
          "Deletion may not remove data already merged into external repositories, sent to third-party integrations, stored in local runtimes, or retained in required security, legal, billing, or backup records.",
        ],
      },
      {
        heading: "Timing",
        body: [
          "We aim to process verified deletion and export requests within 30 days unless a longer period is required because of request complexity, legal requirements, account security, or active disputes.",
        ],
      },
      {
        heading: "Verification",
        body: [
          "We may ask for information needed to verify account ownership, workspace authorization, or administrator authority before exporting or deleting data.",
        ],
      },
      {
        heading: "Contact",
        body: [`Send export or deletion requests to ${CONTACT_EMAIL}.`],
      },
    ],
  },
  cookies: {
    slug: "cookies",
    title: "Cookie Disclosure",
    summary:
      "Cookies and similar storage used by blder.bot, including authentication cookies, preferences, and imported browser cookies.",
    sections: [
      {
        heading: "Service cookies",
        bullets: [
          "Authentication cookies keep users signed in and protect authenticated requests.",
          "Security and session cookies support login, device approval, CSRF protection, and abuse prevention.",
          "Preference storage may remember theme, sidebar, and interface settings.",
        ],
      },
      {
        heading: "Imported browser cookies",
        body: [
          "blder.bot includes an optional Cookie Jar feature. When you import cookies through the CLI or extension, those cookies are customer-provided workspace data, not tracking cookies placed by blder.bot.",
          "Imported cookie values are encrypted at rest. Agents can access imported cookies only for domains explicitly granted to the session, and access is logged in the session stream.",
        ],
      },
      {
        heading: "Analytics and advertising",
        body: [
          "blder.bot does not currently use advertising cookies. If we add analytics or advertising cookies, we will update this disclosure and provide any legally required controls.",
        ],
      },
      {
        heading: "Managing cookies",
        bullets: [
          "You can clear browser cookies through your browser settings.",
          "You can remove imported Cookie Jar entries from blder.bot settings or with the bob CLI.",
          "Blocking required authentication cookies may prevent sign-in or core product features from working.",
        ],
      },
      {
        heading: "Contact",
        body: [`Cookie questions can be sent to ${CONTACT_EMAIL}.`],
      },
    ],
  },
} satisfies Record<string, LegalDocument>;

export const legalDocumentList = Object.values(legalDocuments);

export function legalMetadata(document: LegalDocument): Metadata {
  return {
    title: `${document.title} - blder.bot`,
    description: document.summary,
  };
}

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <main
      id="main-content"
      className="bg-background text-foreground min-h-screen"
    >
      <div className="container py-10 md:py-14">
        <Link
          href="/legal"
          className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
        >
          Legal
        </Link>
        <div className="mt-8 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-10 space-y-1">
              {legalDocumentList.map((item) => (
                <Link
                  key={item.slug}
                  href={`/${item.slug}`}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    item.slug === document.slug
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {item.title}
                </Link>
              ))}
            </nav>
          </aside>

          <article className="mx-auto w-full max-w-3xl">
            <header className="border-border border-b pb-8">
              <p className="text-muted-foreground text-sm font-medium">
                Last updated {LAST_UPDATED}
              </p>
              <h1 className="font-display mt-3 text-4xl font-bold tracking-tight md:text-5xl">
                {document.title}
              </h1>
              <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-7">
                {document.summary}
              </p>
            </header>

            <div className="mt-10 space-y-10">
              {document.sections.map((section) => (
                <section key={section.heading} className="space-y-4">
                  <h2 className="font-display text-2xl font-semibold tracking-tight">
                    {section.heading}
                  </h2>
                  {section.body?.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-muted-foreground text-base leading-7"
                    >
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="text-muted-foreground space-y-2 text-base leading-7">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-3">
                          <span className="bg-primary mt-3 h-1.5 w-1.5 shrink-0 rounded-full" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.table && (
                    <div className="border-border overflow-hidden rounded-lg border">
                      {section.table.map((row) => (
                        <div
                          key={`${row.label}-${row.value}`}
                          className="border-border grid gap-2 border-b p-4 last:border-b-0 md:grid-cols-[160px_minmax(0,1fr)]"
                        >
                          <div>
                            <p className="text-foreground text-sm font-semibold">
                              {row.label}
                            </p>
                          </div>
                          <div>
                            <p className="text-foreground text-sm font-medium">
                              {row.value}
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm leading-6">
                              {row.detail}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </article>
        </div>
      </div>
    </main>
  );
}

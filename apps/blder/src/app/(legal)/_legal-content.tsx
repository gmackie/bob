import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type LegalSection = {
  title: string;
  body: string[];
};

type LegalDocument = {
  slug: string;
  title: string;
  description: string;
  effectiveDate: string;
  updatedDate: string;
  sections: LegalSection[];
};

const contactEmail = "legal@blder.bot";

export const legalDocuments = [
  {
    slug: "terms",
    title: "Terms of Service",
    description: "The rules for using blder.bot and the Bob Builder services.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Agreement",
        body: [
          "These Terms of Service govern access to and use of blder.bot, Bob Builder, the bob CLI, hosted dashboards, APIs, and related services.",
          "By creating an account, connecting a repository, generating an API key, or using the service, you agree to these terms on behalf of yourself or the organization you represent.",
        ],
      },
      {
        title: "Accounts and Workspaces",
        body: [
          "You are responsible for account activity, workspace membership, repository connections, API keys, and credentials created under your account.",
          "Keep credentials confidential and promptly revoke or rotate any key that may have been exposed.",
        ],
      },
      {
        title: "Customer Content",
        body: [
          "Customer Content includes repository metadata, work items, prompts, agent logs, build output, diffs, comments, attachments, and other material submitted to the service.",
          "You retain ownership of Customer Content. You grant us the rights needed to host, process, transmit, display, and secure Customer Content to provide and improve the service.",
        ],
      },
      {
        title: "Acceptable Use",
        body: [
          "You may not use the service to violate law, infringe intellectual property rights, compromise systems without authorization, distribute malware, abuse rate limits, or interfere with service operations.",
          "You are responsible for reviewing agent output, pull requests, generated code, and deployment decisions before relying on them in production.",
        ],
      },
      {
        title: "Service Changes and Availability",
        body: [
          "We may update features, limits, integrations, and infrastructure as the product evolves. We aim to give reasonable notice for material changes that affect paid or production use.",
          "The service may be unavailable during maintenance, incidents, third-party outages, or emergency security work.",
        ],
      },
      {
        title: "Disclaimers and Liability",
        body: [
          "The service is provided as-is to the fullest extent permitted by law. We do not warrant that agent output, generated code, recommendations, or integrations will be error-free or fit for a particular purpose.",
          "To the fullest extent permitted by law, our aggregate liability for claims relating to the service is limited to amounts paid for the service in the twelve months before the claim.",
        ],
      },
      {
        title: "Termination",
        body: [
          "You may stop using the service at any time. We may suspend or terminate access for material breach, security risk, unlawful use, or non-payment.",
          "After termination, Customer Content is handled under our retention and deletion policies.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    description: "How blder.bot collects, uses, protects, and shares personal data.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Information We Collect",
        body: [
          "We collect account information such as name, email address, authentication identifiers, organization membership, and billing status when applicable.",
          "We collect service data such as workspace settings, repository metadata, work items, agent runs, logs, diffs, comments, attachments, API activity, device codes, and audit events needed to operate blder.bot.",
          "We collect technical data such as IP address, user agent, timestamps, request identifiers, error reports, and diagnostic logs.",
        ],
      },
      {
        title: "How We Use Information",
        body: [
          "We use information to provide the service, authenticate users, synchronize connected repositories, process agent runs, maintain security, troubleshoot incidents, prevent abuse, and communicate service updates.",
          "We may use aggregated or de-identified information to understand product reliability, performance, and usage patterns.",
        ],
      },
      {
        title: "Sharing",
        body: [
          "We share information with subprocessors that provide hosting, authentication, storage, monitoring, email, analytics, payments, and infrastructure services.",
          "We may disclose information when required by law, to protect rights and safety, to investigate abuse, or as part of a merger, acquisition, financing, or sale of assets.",
        ],
      },
      {
        title: "Customer Content and Connected Services",
        body: [
          "When you connect third-party services such as GitHub, we process data according to the permissions you grant and the configuration of your workspace.",
          "You should avoid submitting secrets, regulated data, or production credentials unless the applicable plan and written agreement explicitly support that use.",
        ],
      },
      {
        title: "International Processing",
        body: [
          "We may process information in the United States and other countries where we or our subprocessors operate.",
          "Where required, we use appropriate transfer safeguards for personal data transferred across borders.",
        ],
      },
      {
        title: "Your Choices",
        body: [
          "You may request access, correction, export, or deletion of personal data by contacting us. Workspace administrators can manage many records directly in the product.",
          "You may disconnect integrations, revoke API keys, and remove users from workspaces subject to retention, security, legal, and backup limitations.",
        ],
      },
    ],
  },
  {
    slug: "dpa",
    title: "Data Processing Addendum",
    description: "Processor commitments for customer personal data handled by blder.bot.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Roles",
        body: [
          "For Customer Personal Data submitted to the service, the customer is the controller or processor and Bob Builder acts as a processor or subprocessor as applicable.",
          "Customer Personal Data means personal data contained in Customer Content or service configuration that we process on the customer's behalf.",
        ],
      },
      {
        title: "Processing Instructions",
        body: [
          "We process Customer Personal Data only to provide, secure, support, and improve the service, to comply with customer instructions in the agreement, and as required by law.",
          "Customers are responsible for ensuring they have a lawful basis and appropriate notices for the data they submit to blder.bot.",
        ],
      },
      {
        title: "Security Measures",
        body: [
          "We maintain administrative, technical, and organizational safeguards designed to protect Customer Personal Data against unauthorized access, loss, misuse, alteration, and disclosure.",
          "Security measures include access controls, encryption in transit, secret handling practices, logging, monitoring, backup controls, and vulnerability management appropriate to the service stage.",
        ],
      },
      {
        title: "Subprocessors",
        body: [
          "We may use subprocessors to provide hosting, infrastructure, authentication, storage, monitoring, email, analytics, payments, and support services.",
          "We require subprocessors to protect Customer Personal Data under written obligations materially consistent with this DPA.",
        ],
      },
      {
        title: "Assistance",
        body: [
          "We will provide reasonable assistance for data subject requests, security questionnaires, impact assessments, and regulatory inquiries where the requested information is not available in the product.",
          "Requests should be sent to legal@blder.bot and must identify the workspace, account, and data at issue.",
        ],
      },
      {
        title: "Deletion and Return",
        body: [
          "Upon termination or written request, we will delete or return Customer Personal Data according to our deletion and retention policies unless law or legitimate security needs require continued retention.",
        ],
      },
    ],
  },
  {
    slug: "subprocessors",
    title: "Subprocessors",
    description: "Third-party providers used to operate and secure blder.bot.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Current Subprocessors",
        body: [
          "Cloudflare: application hosting, edge delivery, security, DNS, Workers, and related infrastructure.",
          "Hetzner: production database and server infrastructure for environments backed by ForgeGraph PostgreSQL.",
          "GitHub: source control integration, repository metadata, pull requests, issues, and identity signals when customers connect GitHub.",
          "Configured identity providers: authentication, session handling, account linking, and sign-in flows.",
          "Email, monitoring, analytics, and payment providers may be used as configured for the deployed environment and customer plan.",
        ],
      },
      {
        title: "Purpose Limitation",
        body: [
          "Subprocessors receive only the data needed for their role in delivering, securing, monitoring, supporting, or billing the service.",
          "We do not sell Customer Content or Customer Personal Data.",
        ],
      },
      {
        title: "Changes",
        body: [
          "We will update this page when material subprocessors change. Enterprise customers may request advance notice terms in a separate written agreement.",
          "Questions or objections about subprocessors can be sent to legal@blder.bot.",
        ],
      },
    ],
  },
  {
    slug: "data-retention",
    title: "Data Retention",
    description: "How long blder.bot keeps operational, customer, and security data.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Active Workspaces",
        body: [
          "Workspace records, projects, work items, comments, agent runs, artifacts, logs, API keys, and integration settings are retained while the workspace remains active and as needed to provide the service.",
          "Customers can remove many records directly in the product, subject to backup, audit, security, and legal retention requirements.",
        ],
      },
      {
        title: "Operational Logs",
        body: [
          "Application logs, audit events, request metadata, and security telemetry are retained for the period needed to operate the service, investigate abuse, debug incidents, and maintain reliability.",
          "Retention periods may vary by environment, plan, legal requirement, and operational need.",
        ],
      },
      {
        title: "Backups",
        body: [
          "Backups are maintained to recover from operational failures, data corruption, and security incidents.",
          "Deleted records may remain in encrypted backups until those backups expire or are overwritten according to the backup lifecycle.",
        ],
      },
      {
        title: "Closed Accounts",
        body: [
          "After account closure or workspace deletion, we delete or anonymize Customer Content within a reasonable period unless retention is required for security, dispute resolution, compliance, fraud prevention, or backup integrity.",
        ],
      },
    ],
  },
  {
    slug: "deletion-export",
    title: "Deletion and Export",
    description: "How customers can request data exports and deletion from blder.bot.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Exports",
        body: [
          "Workspace administrators may request an export of account, workspace, project, work item, run, artifact, comment, and configuration data associated with their workspace.",
          "Exports are provided in a reasonable machine-readable format when technically feasible and subject to identity, authorization, security, and third-party rights checks.",
        ],
      },
      {
        title: "Deletion Requests",
        body: [
          "Workspace administrators may request deletion of a workspace or specific Customer Content by contacting legal@blder.bot.",
          "Requests should include the workspace name, account email, affected records, and whether connected integrations should also be disconnected or revoked.",
        ],
      },
      {
        title: "Verification",
        body: [
          "We verify deletion and export requests to protect customer workspaces from unauthorized access or destructive actions.",
          "For organization workspaces, we may require approval from an owner or administrator before completing the request.",
        ],
      },
      {
        title: "Limits",
        body: [
          "Deletion may not remove data already exported by customers, retained by connected third-party services, present in immutable audit records, or preserved in backups until expiration.",
          "We may retain limited records when required for security, compliance, fraud prevention, billing, dispute resolution, or legal obligations.",
        ],
      },
    ],
  },
  {
    slug: "security",
    title: "Security",
    description: "Security practices for blder.bot accounts, integrations, and data.",
    effectiveDate: "May 30, 2026",
    updatedDate: "May 30, 2026",
    sections: [
      {
        title: "Security Program",
        body: [
          "blder.bot is built around developer workflows that can include sensitive repository metadata, agent logs, diffs, and operational context.",
          "We use layered safeguards across authentication, authorization, infrastructure, application code, monitoring, incident response, and operational access.",
        ],
      },
      {
        title: "Access Controls",
        body: [
          "Access to customer workspaces is controlled through authenticated accounts, workspace roles, session controls, integration permissions, and API keys.",
          "Customers should grant the least repository and workspace access needed, remove inactive users, and rotate API keys when access changes.",
        ],
      },
      {
        title: "Data Protection",
        body: [
          "Traffic to production services is encrypted in transit. Secrets and credentials are handled through environment and deployment controls rather than committed source code.",
          "Customer data is stored in managed infrastructure with access restricted to authorized operational needs.",
        ],
      },
      {
        title: "Monitoring and Response",
        body: [
          "We monitor service health, application errors, suspicious activity, and infrastructure events to detect reliability and security issues.",
          "Confirmed security incidents are investigated, contained, remediated, and communicated as required by law and customer agreements.",
        ],
      },
      {
        title: "Vulnerability Reports",
        body: [
          "Report suspected vulnerabilities to security@blder.bot with affected URLs, steps to reproduce, impact, and any relevant logs or screenshots.",
          "Do not access, modify, exfiltrate, or delete data that does not belong to you while researching a report.",
        ],
      },
    ],
  },
] satisfies LegalDocument[];

export const legalNav = legalDocuments.map((document) => ({
  href: `/${document.slug}`,
  label: document.title,
}));

export function getLegalDocument(slug: string) {
  return legalDocuments.find((document) => document.slug === slug);
}

export function getLegalMetadata(slug: string): Metadata {
  const document = getLegalDocument(slug);

  if (!document) {
    return {};
  }

  return {
    title: `${document.title} - blder.bot`,
    description: document.description,
    openGraph: {
      title: `${document.title} - blder.bot`,
      description: document.description,
      url: `https://blder.bot/${document.slug}`,
      siteName: "blder.bot",
    },
  };
}

export function LegalDocumentPage({ slug }: { slug: string }) {
  const document = getLegalDocument(slug);

  if (!document) {
    notFound();
  }

  return (
    <main id="main-content" className="min-h-screen bg-background text-foreground">
      <div className="container grid gap-10 py-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-14">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Link className="font-display text-lg font-semibold" href="/legal">
            blder.bot legal
          </Link>
          <nav className="mt-6 grid gap-1 text-sm">
            {legalNav.map((item) => (
              <Link
                className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <article className="mx-auto w-full max-w-3xl">
          <header className="border-b border-border pb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Launch legal
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-foreground md:text-5xl">
              {document.title}
            </h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              {document.description}
            </p>
            <dl className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-foreground">Effective</dt>
                <dd>{document.effectiveDate}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Last updated</dt>
                <dd>{document.updatedDate}</dd>
              </div>
            </dl>
          </header>

          <div className="space-y-10 py-8">
            {document.sections.map((section) => (
              <section className="space-y-3" key={section.title}>
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  {section.title}
                </h2>
                {section.body.map((paragraph) => (
                  <p
                    className="text-sm leading-7 text-muted-foreground md:text-base"
                    key={paragraph}
                  >
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>

          <footer className="border-t border-border py-8 text-sm leading-6 text-muted-foreground">
            Questions about this document can be sent to{" "}
            <a
              className="font-medium text-primary hover:underline"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </footer>
        </article>
      </div>
    </main>
  );
}

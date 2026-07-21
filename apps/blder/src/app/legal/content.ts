export type LegalSection = {
  title: string;
  body?: string[];
  bullets?: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
};

export type LegalPage = {
  slug: string;
  title: string;
  summary: string;
  lastUpdated: string;
  sections: LegalSection[];
};

const lastUpdated = "July 8, 2026";

export const legalPages = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    summary:
      "Rules for using blder.bot, Bob, OODA, and related platform services.",
    lastUpdated,
    sections: [
      {
        title: "Agreement",
        body: [
          "These Terms govern access to blder.bot and related services we operate under the blder.bot domain, including Bob and OODA. By using the services, creating an account, or connecting a workspace, you agree to these Terms on behalf of yourself or the organization you represent.",
          "If you use the services for an organization, you confirm that you have authority to bind that organization. If you do not agree to these Terms, do not use the services.",
        ],
      },
      {
        title: "Accounts and access",
        bullets: [
          "You are responsible for maintaining account security and for activity under your account.",
          "You must provide accurate account, billing, and contact information when requested.",
          "You may not share credentials or use another person's account without permission.",
          "We may suspend access if we believe an account is compromised, unlawful, or creates security or operational risk.",
        ],
      },
      {
        title: "Acceptable use",
        bullets: [
          "Do not use the services to violate law, infringe intellectual property rights, or abuse third-party systems.",
          "Do not attempt to bypass authentication, authorization, rate limits, audit logging, or security controls.",
          "Do not upload malware or intentionally harmful code.",
          "Do not use the services to process sensitive regulated data unless we have agreed in writing that the services are appropriate for that data.",
        ],
      },
      {
        title: "Customer content",
        body: [
          "You retain ownership of code, prompts, repositories, project data, credentials, and other content you submit to the services. You grant us the limited rights needed to host, secure, process, transmit, and display that content to provide and improve the services.",
          "You are responsible for ensuring that you have the rights and permissions needed to submit content and connect third-party services.",
        ],
      },
      {
        title: "Third-party services",
        body: [
          "The services may connect to third-party tools such as GitHub, hosted model providers, observability providers, or infrastructure services. Third-party services are governed by their own terms and privacy policies.",
          "You are responsible for configuring third-party integrations and permissions appropriately.",
        ],
      },
      {
        title: "Beta features and changes",
        body: [
          "Some features may be marked beta, preview, experimental, or otherwise pre-release. These features may change, be unavailable, or produce incomplete results.",
          "We may modify or discontinue features as the platform evolves. We will make reasonable efforts to avoid materially reducing core functionality without notice.",
        ],
      },
      {
        title: "Disclaimers and liability",
        body: [
          "The services are provided as-is and as-available to the fullest extent permitted by law. We do not warrant that outputs will be error-free, secure, or fit for a particular purpose.",
          "To the fullest extent permitted by law, our aggregate liability for claims relating to the services is limited to the amount you paid for the services in the twelve months before the event giving rise to the claim.",
        ],
      },
      {
        title: "Contact",
        body: [
          "Questions about these Terms can be sent to legal@blder.bot.",
        ],
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "How blder.bot collects, uses, shares, and protects personal information.",
    lastUpdated,
    sections: [
      {
        title: "Information we collect",
        bullets: [
          "Account information, such as name, email address, organization, and authentication identifiers.",
          "Workspace information, such as connected repositories, project metadata, task records, session logs, node status, and integration configuration.",
          "Authentication and integration data, such as OAuth tokens, API keys, and scoped permissions needed to operate connected services.",
          "Usage and diagnostic data, such as request metadata, device information, logs, errors, performance metrics, and security events.",
          "Communications you send us, including support, legal, and security requests.",
        ],
      },
      {
        title: "How we use information",
        bullets: [
          "Provide, secure, debug, and maintain the services.",
          "Authenticate users and enforce workspace permissions.",
          "Operate agent sessions, connected nodes, repository workflows, and platform integrations.",
          "Detect abuse, investigate security events, and preserve audit trails.",
          "Communicate about service updates, support, billing, security, and legal notices.",
          "Improve reliability, performance, and product quality.",
        ],
      },
      {
        title: "Sharing",
        body: [
          "We share information with subprocessors and service providers that help us host, secure, monitor, and operate the services. We may also share information when required by law, to protect rights and safety, or in connection with a corporate transaction.",
          "We do not sell personal information. We do not use customer content to train third-party foundation models unless you configure a feature or provider that requires sending content to that provider.",
        ],
      },
      {
        title: "Retention",
        body: [
          "We retain personal information for as long as needed to provide the services, comply with legal obligations, resolve disputes, enforce agreements, maintain security, and preserve auditability.",
          "Workspace data, session records, and logs may have different retention periods depending on plan, configuration, and operational needs.",
        ],
      },
      {
        title: "International processing",
        body: [
          "We may process information in the United States and other locations where we or our subprocessors operate. When required, we use appropriate transfer safeguards for cross-border processing.",
        ],
      },
      {
        title: "Your choices",
        bullets: [
          "You can request access, correction, export, or deletion of personal information by contacting privacy@blder.bot.",
          "Workspace administrators can disconnect integrations and remove users from the workspace.",
          "Browser controls can block or delete cookies, though some authentication features may stop working.",
        ],
      },
      {
        title: "Contact",
        body: [
          "Privacy requests can be sent to privacy@blder.bot.",
        ],
      },
    ],
  },
  dpa: {
    slug: "dpa",
    title: "Data Processing Addendum",
    summary:
      "Processing terms for customer personal data handled by blder.bot as a processor.",
    lastUpdated,
    sections: [
      {
        title: "Scope",
        body: [
          "This Data Processing Addendum applies when blder.bot processes personal data on behalf of a customer in connection with the services and the customer is the controller or processor of that personal data.",
          "The DPA is incorporated into the agreement governing use of the services. If there is a conflict, this DPA controls for processing of customer personal data.",
        ],
      },
      {
        title: "Roles",
        bullets: [
          "Customer is the controller or processor of customer personal data.",
          "blder.bot acts as processor or subprocessor for customer personal data processed to provide the services.",
          "Each party will comply with privacy and data protection laws applicable to its role.",
        ],
      },
      {
        title: "Processing details",
        table: {
          headers: ["Category", "Details"],
          rows: [
            ["Subject matter", "Provision, security, support, and improvement of the services."],
            ["Duration", "The term of the customer agreement plus any lawful retention period."],
            ["Data subjects", "Users, workspace members, customer personnel, contractors, and people whose data appears in customer content."],
            ["Data categories", "Account data, workspace data, repository and task metadata, logs, communications, and integration data."],
            ["Processing operations", "Hosting, storage, retrieval, transmission, analysis, support, monitoring, security, deletion, and export."],
          ],
        },
      },
      {
        title: "Instructions",
        body: [
          "We will process customer personal data only to provide the services, follow documented customer instructions, comply with law, or as otherwise permitted by the agreement.",
        ],
      },
      {
        title: "Security",
        body: [
          "We maintain technical and organizational measures designed to protect customer personal data against unauthorized access, disclosure, alteration, and destruction. Current measures are summarized on the Security page.",
        ],
      },
      {
        title: "Subprocessors",
        body: [
          "Customer authorizes use of subprocessors listed on the Subprocessors page. We remain responsible for subprocessors' processing of customer personal data as required by applicable law and our agreement with customer.",
        ],
      },
      {
        title: "International transfers",
        body: [
          "Where required for transfers of personal data outside its origin jurisdiction, the parties will use an appropriate transfer mechanism such as the EU Standard Contractual Clauses or another lawful safeguard.",
        ],
      },
      {
        title: "Assistance and deletion",
        body: [
          "We will provide reasonable assistance for data subject requests, security obligations, and impact assessments where required and where the requested information is not otherwise available to customer through the services.",
          "At the end of service, we will delete or return customer personal data according to the Data Deletion and Export page, unless retention is required by law or legitimate security and backup obligations.",
        ],
      },
    ],
  },
  subprocessors: {
    slug: "subprocessors",
    title: "Subprocessors",
    summary:
      "Service providers used to host, secure, authenticate, monitor, and operate blder.bot.",
    lastUpdated,
    sections: [
      {
        title: "Current subprocessors",
        table: {
          headers: ["Provider", "Purpose", "Data processed"],
          rows: [
            ["Cloudflare", "Edge hosting, networking, DNS, security, and database connectivity.", "Request metadata, logs, account and workspace data transmitted through the service."],
            ["Sentry", "Error monitoring, performance diagnostics, and incident debugging.", "Error traces, request metadata, diagnostic logs, and limited user or workspace identifiers."],
            ["GitHub", "OAuth authentication and repository integrations when enabled by a user or workspace.", "OAuth identifiers, email address, repository metadata, and content accessible under granted scopes."],
            ["Tailscale", "Private connectivity and node identity for connected runner devices.", "Device names, network metadata, and node connectivity status."],
            ["Managed PostgreSQL infrastructure", "Primary application database hosting and storage.", "Account data, workspace data, integration configuration, session records, logs, and operational data."],
          ],
        },
      },
      {
        title: "Optional providers",
        body: [
          "Some workspaces may configure additional model, repository, issue tracking, observability, or automation providers. Those providers process data only when the workspace enables the integration or routes tasks through that provider.",
        ],
      },
      {
        title: "Updates",
        body: [
          "We may update subprocessors as the platform changes. Material changes will be reflected on this page. For current security or procurement review, contact security@blder.bot.",
        ],
      },
    ],
  },
  security: {
    slug: "security",
    title: "Security",
    summary:
      "Security practices for protecting blder.bot accounts, workspaces, integrations, and infrastructure.",
    lastUpdated,
    sections: [
      {
        title: "Program",
        body: [
          "blder.bot uses layered security controls across identity, infrastructure, application code, data stores, and operational monitoring. Controls are reviewed as the platform evolves and as new customer use cases are added.",
        ],
      },
      {
        title: "Identity and access",
        bullets: [
          "Authentication is handled through better-auth with GitHub OAuth for platform sign-in.",
          "Session cookies are scoped to blder.bot domains and configured for production use.",
          "Access to connected repositories and integrations is limited by OAuth scopes and workspace configuration.",
          "Internal access is limited to personnel with a business need and may be revoked when no longer required.",
        ],
      },
      {
        title: "Data protection",
        bullets: [
          "Production traffic is protected in transit with HTTPS/TLS.",
          "Application secrets and OAuth credentials are stored in managed secret environments or encrypted storage appropriate to the service.",
          "Databases and infrastructure are hosted by managed providers with physical and environmental safeguards.",
          "Imported cookies and sensitive integration values are treated as secrets and should be granted only to sessions that need them.",
        ],
      },
      {
        title: "Infrastructure",
        bullets: [
          "The platform runs on Cloudflare Workers and related Cloudflare services.",
          "Database connectivity uses Cloudflare Hyperdrive where configured.",
          "Runner devices are expected to connect through private networking controls and report heartbeat status to the platform.",
          "Operational logs and error telemetry are monitored to detect failures and investigate incidents.",
        ],
      },
      {
        title: "Product controls",
        bullets: [
          "Workspace administrators control connected services, users, and node access.",
          "Agent sessions should be scoped to the repositories, domains, credentials, and tools required for the task.",
          "Audit-oriented session records and logs are retained to support troubleshooting and investigation.",
        ],
      },
      {
        title: "Security reports",
        body: [
          "Report suspected vulnerabilities or security incidents to security@blder.bot. Please include affected URLs, reproduction steps, impact, and any relevant logs or screenshots.",
        ],
      },
    ],
  },
  data: {
    slug: "data-deletion-export",
    title: "Data Deletion and Export",
    summary:
      "How customers can request deletion, account removal, workspace export, and integration revocation.",
    lastUpdated,
    sections: [
      {
        title: "Export",
        body: [
          "Customers can request export of account and workspace data by contacting privacy@blder.bot or support@blder.bot. Include the workspace name, requesting administrator, data categories, and preferred format.",
          "Exports may include account records, workspace metadata, task and session records, node records, audit logs, and other customer-controlled data that can be reasonably exported from active systems.",
        ],
      },
      {
        title: "Deletion",
        body: [
          "Customers can request deletion of an account, workspace, integration, repository connection, runner node, or imported credential. We may require administrator verification before acting on workspace-wide deletion requests.",
          "Deletion from active systems is typically completed within 30 days after verification unless a shorter period is required by law or a longer period is needed for fraud prevention, security, legal compliance, billing, dispute resolution, or backup expiration.",
        ],
      },
      {
        title: "Integration revocation",
        bullets: [
          "Disconnect integrations in the service where available.",
          "Revoke OAuth grants directly in the third-party provider, such as GitHub, when immediate provider-side revocation is needed.",
          "Rotate external API keys, repository tokens, and imported credentials after removing access.",
        ],
      },
      {
        title: "Backups and logs",
        body: [
          "Deleted data may remain in encrypted backups, security logs, or audit records until those systems expire through normal retention. We restrict use of retained backup and log data to recovery, security, compliance, and legal purposes.",
        ],
      },
      {
        title: "Requests",
        body: [
          "Send deletion or export requests to privacy@blder.bot. Security-sensitive credential revocation requests can also be sent to security@blder.bot.",
        ],
      },
    ],
  },
  cookies: {
    slug: "cookies",
    title: "Cookie Disclosures",
    summary:
      "Cookies and similar technologies used for authentication, security, and platform operation.",
    lastUpdated,
    sections: [
      {
        title: "How we use cookies",
        body: [
          "blder.bot uses cookies and similar browser storage for authentication, session continuity, security, and basic service operation. We do not use third-party advertising cookies on blder.bot launch pages.",
        ],
      },
      {
        title: "Cookie categories",
        table: {
          headers: ["Category", "Purpose", "Examples"],
          rows: [
            ["Essential", "Keep users signed in, protect sessions, route requests, and prevent cross-site request abuse.", "better-auth session cookies and related security cookies."],
            ["Security", "Detect suspicious activity, protect infrastructure, and support abuse prevention.", "Cloudflare security and routing cookies where applicable."],
            ["Diagnostics", "Understand errors and performance issues.", "Request and error identifiers associated with Sentry or platform logs."],
          ],
        },
      },
      {
        title: "User-controlled imported cookies",
        body: [
          "Some blder.bot products may allow authorized users to import or grant cookies from third-party domains to agent sessions so those sessions can interact with authenticated websites. Those cookies are customer-provided credentials and should be granted only when necessary for a task.",
          "Imported cookie values are treated as sensitive credentials. Access should be scoped by domain, workspace, and session.",
        ],
      },
      {
        title: "Choices",
        body: [
          "You can block or delete cookies through browser settings. Essential authentication and security cookies are required for signed-in areas of the services, so blocking them may prevent login or break core functionality.",
        ],
      },
      {
        title: "Contact",
        body: [
          "Questions about cookies can be sent to privacy@blder.bot.",
        ],
      },
    ],
  },
} satisfies Record<string, LegalPage>;

export const legalNavigation = [
  legalPages.terms,
  legalPages.privacy,
  legalPages.dpa,
  legalPages.subprocessors,
  legalPages.security,
  legalPages.data,
  legalPages.cookies,
] as const;


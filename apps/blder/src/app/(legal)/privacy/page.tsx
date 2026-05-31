import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - blder.bot",
  description: "Privacy Policy for blder.bot.",
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <p className="text-primary text-sm font-semibold tracking-wide uppercase">
        Effective May 31, 2026
      </p>
      <h1>Privacy Policy</h1>
      <p>
        This Privacy Policy explains how Forgegraph collects, uses, discloses,
        and protects personal information when you use blder.bot, our websites,
        applications, APIs, and related services.
      </p>

      <h2>Information We Collect</h2>
      <p>
        We collect information you provide directly, including account details,
        contact information, workspace and project content, support messages,
        billing details, and configuration data for repositories, agents, and
        integrations you connect to the service.
      </p>
      <p>
        We also collect usage, device, log, cookie, and diagnostic information,
        such as IP address, browser type, pages viewed, feature usage, session
        events, error reports, and approximate location inferred from network
        information.
      </p>

      <h2>How We Use Information</h2>
      <p>
        We use personal information to provide, secure, maintain, and improve
        the service; authenticate users; process payments; operate workspaces;
        respond to support requests; send service communications; prevent abuse;
        comply with legal obligations; and develop new features.
      </p>

      <h2>Project Content and Connected Services</h2>
      <p>
        If you connect third-party services, such as source control providers or
        payment processors, we process information from those services only as
        needed to provide the features you request. You are responsible for
        ensuring you have the right to submit project content and repository
        data to the service.
      </p>

      <h2>Sharing of Information</h2>
      <p>
        We do not sell personal information. We may share information with
        vendors and service providers who help us operate the service, with
        connected third-party integrations at your direction, as part of a
        business transaction, to comply with law, or to protect rights, safety,
        and security.
      </p>

      <h2>Payment Processing</h2>
      <p>
        Payments are processed by Stripe or another payment processor. We do not
        store full payment card numbers on our systems. Payment processors
        collect and process billing information according to their own terms and
        privacy policies.
      </p>

      <h2>Security and Retention</h2>
      <p>
        We use administrative, technical, and organizational safeguards designed
        to protect personal information. We retain information for as long as
        needed to provide the service, comply with legal obligations, resolve
        disputes, enforce agreements, and maintain business records.
      </p>

      <h2>Your Choices</h2>
      <p>
        You may update account information, disconnect integrations, or request
        access, correction, deletion, or export of personal information by
        contacting us. Some information may be retained where required by law or
        legitimate business needs.
      </p>

      <h2>International Processing</h2>
      <p>
        We may process information in the United States and other countries
        where we or our service providers operate. Those countries may have
        different data protection laws than your jurisdiction.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. If changes are
        material, we will take reasonable steps to notify users through the
        service or other appropriate channels.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this Privacy Policy may be sent to{" "}
        <a href="mailto:legal@blder.bot">legal@blder.bot</a>.
      </p>
    </article>
  );
}

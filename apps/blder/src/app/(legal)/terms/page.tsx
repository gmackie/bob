import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - blder.bot",
  description: "Terms of Service for blder.bot.",
};

export default function TermsPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <p className="text-primary text-sm font-semibold tracking-wide uppercase">
        Effective May 31, 2026
      </p>
      <h1>Terms of Service</h1>
      <p>
        These Terms of Service govern access to and use of blder.bot, including
        our websites, applications, APIs, and related services provided by
        Forgegraph. By using the service, you agree to these terms.
      </p>

      <h2>Accounts</h2>
      <p>
        You must provide accurate account information and keep credentials
        secure. You are responsible for activity under your account and for
        ensuring that anyone you invite to a workspace follows these terms.
      </p>

      <h2>Use of the Service</h2>
      <p>
        You may use the service only in compliance with applicable laws and
        these terms. You may not misuse the service, attempt unauthorized
        access, interfere with service operation, reverse engineer restricted
        portions of the service, or use the service to infringe the rights of
        others.
      </p>

      <h2>Customer Content</h2>
      <p>
        You retain ownership of content, code, prompts, repository data,
        configuration, and other materials you submit to the service. You grant
        Forgegraph the rights needed to host, process, transmit, display, and
        otherwise use customer content to provide and improve the service.
      </p>

      <h2>AI Outputs</h2>
      <p>
        The service may generate plans, code, summaries, commands, or other
        outputs. You are responsible for reviewing and validating outputs before
        relying on them, merging them, deploying them, or using them in
        production systems.
      </p>

      <h2>Third-Party Services</h2>
      <p>
        The service may connect to third-party platforms, including source
        control providers, hosting platforms, model providers, and payment
        processors. Your use of third-party services is governed by their own
        terms and policies.
      </p>

      <h2>Fees and Payment</h2>
      <p>
        Paid plans, subscriptions, and usage-based charges are billed according
        to the pricing and checkout terms presented when you purchase. You
        authorize us and our payment processor to charge applicable fees, taxes,
        and renewals unless you cancel as permitted by the service.
      </p>

      <h2>Availability and Changes</h2>
      <p>
        We may modify, suspend, or discontinue features as the service evolves.
        We aim to provide reliable service, but we do not guarantee that the
        service will be uninterrupted, error-free, or available in every
        location.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The service is provided on an "as is" and "as available" basis without
        warranties of any kind, whether express, implied, or statutory,
        including implied warranties of merchantability, fitness for a
        particular purpose, title, and non-infringement.
      </p>

      <h2>Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Forgegraph will not be liable
        for indirect, incidental, special, consequential, exemplary, or punitive
        damages, or for lost profits, revenue, goodwill, data, or business
        opportunities.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the service at any time. We may suspend or terminate
        access if you violate these terms, create security or legal risk, fail
        to pay fees, or otherwise misuse the service.
      </p>

      <h2>Changes to These Terms</h2>
      <p>
        We may update these terms from time to time. If changes are material, we
        will take reasonable steps to notify users through the service or other
        appropriate channels.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms of Service may be sent to{" "}
        <a href="mailto:legal@blder.bot">legal@blder.bot</a>.
      </p>
    </article>
  );
}

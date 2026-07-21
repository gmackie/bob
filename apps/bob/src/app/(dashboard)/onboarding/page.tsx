import Link from "next/link";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import {
  getCustomerOnboardingStepHref,
  getCustomerOnboardingStepNumber,
  getCustomerOnboardingSteps,
} from "~/components/onboarding/customer-onboarding-model";

interface OnboardingPageProps {
  searchParams?: Promise<{ workspace?: string | string[] }>;
}

export default async function CustomerOnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const query = await searchParams;
  const workspaceId =
    typeof query?.workspace === "string" ? query.workspace : null;
  const steps = getCustomerOnboardingSteps();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Onboarding" }]} className="mb-4" />

      <header className="border-b border-border pb-8">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Customer setup
        </div>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold leading-[1.15] tracking-tight text-foreground">
              Onboarding checklist
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Follow these steps to move a new customer from GitHub login to a
              verified first task run.
            </p>
          </div>
          <Link
            href={
              workspaceId
                ? `/tasks?workspace=${encodeURIComponent(workspaceId)}`
                : "/tasks"
            }
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open dashboard
          </Link>
        </div>
      </header>

      <section className="mt-8 grid gap-4">
        {steps.map((step, index) => (
          <article
            key={step.key}
            className="grid gap-4 rounded-lg border border-border bg-card p-5 md:grid-cols-[72px_minmax(0,1fr)_auto] md:items-center"
          >
            <div className="flex size-12 items-center justify-center rounded-md border border-border bg-background font-mono text-sm font-semibold text-muted-foreground">
              {getCustomerOnboardingStepNumber(index)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  {step.title}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {step.owner}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {step.description}
              </p>
            </div>
            <Link
              href={getCustomerOnboardingStepHref(step, workspaceId)}
              className="inline-flex items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent md:justify-self-end"
            >
              {step.actionLabel}
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}

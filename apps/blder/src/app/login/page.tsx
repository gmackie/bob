import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { LoginForm } from "./_components/login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-fg-canvas px-4 py-16 text-foreground">
      <div className="pointer-events-none absolute -top-48 left-[-12%] h-80 w-80 rounded-full bg-cyan-500/35 blur-[140px]" />
      <div className="pointer-events-none absolute top-10 right-[-8%] h-72 w-72 rounded-full bg-emerald-500/28 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-12%] left-[20%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[150px]" />

      <div className="mx-auto grid w-full max-w-5xl items-center gap-10 rounded-[28px] border border-border bg-fg-panel p-8 shadow-[0_26px_90px_rgba(0,0,0,.7)] backdrop-blur-xl md:grid-cols-2 md:p-10">
        <section className="space-y-6">
          <p className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-200">
            AI command center
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
            blder.bot
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
            A streamlined control room for orchestrating AI agents, repositories,
            and worktrees across your full development stack.
          </p>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-300" />
              Live project and agent status at a glance.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-cyan-300" />
              Quick terminal handoff with context-aware session streams.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-violet-300" />
              Fast start-up with GitHub sign-in and workspace-aware auth.
            </li>
          </ul>
        </section>

        <section className="w-full">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}

import { LoginForm } from "./_components/login-form";

export default function LoginPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-background px-4 py-16 text-foreground">
      <div className="pointer-events-none absolute -top-48 left-[-12%] h-80 w-80 rounded-full bg-cyan-500/35 blur-[140px]" />
      <div className="pointer-events-none absolute top-10 right-[-8%] h-72 w-72 rounded-full bg-emerald-500/28 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-12%] left-[20%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[150px]" />

      <div className="mx-auto grid w-full max-w-5xl items-center gap-10 rounded-[28px] border border-border bg-accent p-8 shadow-[0_26px_90px_rgba(0,0,0,.7)] backdrop-blur-xl md:grid-cols-2 md:p-10">
        <section className="space-y-6">
          <p className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-200">
            Platform
          </p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            blder.bot
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
            Sign in to manage nodes, services, and deployments across the
            blder.bot platform.
          </p>
        </section>

        <section className="w-full">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}

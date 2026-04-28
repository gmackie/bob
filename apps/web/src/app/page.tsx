// apps/web/src/app/page.tsx — gmacko reference impl landing page.
// Agent-harness UI lives at /agent. This page is intentionally minimal.
export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">gmacko reference impl</h1>
      <p className="mt-2">
        See <a href="/agent" className="underline">/agent</a> for the CLI agent harness,
        {" "}<a href="/dashboard" className="underline">/dashboard</a> for navigation.
      </p>
    </main>
  );
}

import { NodeList } from "~/components/node-list";

export default function NodesPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Nodes
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tailscale-connected runner devices registered to the platform.
            </p>
          </div>
          <a
            href="/"
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
          >
            Home
          </a>
        </div>

        <NodeList />
      </div>
    </main>
  );
}

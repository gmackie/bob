"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AuthedOnly, useCurrentUser, useRpcClient, TenantPicker } from "@gmacko/core/app-shell";
import { ThemeSwitcher } from "@gmacko/core/ui";

function DashboardInner() {
  const me = useCurrentUser();
  const client = useRpcClient();

  const memberships = useQuery({
    queryKey: ["currentUser", "memberships"],
    queryFn: () => client.auth.listMemberships(),
  });

  if (me.isLoading) return <p>Loading…</p>;
  if (!me.data) return null;

  return (
    <main style={{ maxWidth: "800px", margin: "2rem auto", padding: "1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Dashboard</h1>
        <ThemeSwitcher />
      </header>
      <p>
        Signed in as <strong>{me.data.email}</strong> · tenant{" "}
        <code>{me.data.tenantId}</code> · role <code>{me.data.role}</code>
      </p>

      {memberships.data && memberships.data.length > 1 && (
        <section>
          <h2>Switch tenant</h2>
          <TenantPicker />
        </section>
      )}

      <nav>
        <h2>gmacko</h2>
        <ul>
          <li><Link href="/projects">Projects</Link></li>
          <li><Link href="/agent">Agent</Link></li>
          <li><Link href="/secrets">Secrets</Link></li>
        </ul>
        <h2>OODA (legacy)</h2>
        <ul>
          <li><Link href="/">Home (capture)</Link></li>
          <li><Link href="/graph">Graph</Link></li>
          <li><Link href="/wiki">Wiki</Link></li>
          <li><Link href="/explore">Explore</Link></li>
        </ul>
      </nav>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <AuthedOnly>
      <DashboardInner />
    </AuthedOnly>
  );
}

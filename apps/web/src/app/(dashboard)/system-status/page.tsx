"use client";

import React from "react";
import { useRouter } from "next/navigation";

import { SystemStatusPanel } from "~/components/dashboard";

export default function SystemStatusPage() {
  const router = useRouter();

  return (
    <div className="dash-systemStatusShell">
      <header className="dash-systemStatusHeader">
        <div>
          <div className="dash-systemStatusBadge">Ops</div>
          <h1 className="dash-systemStatusTitle">System Status</h1>
          <div className="dash-systemStatusSubhead">
            Health checks, dependencies, and agent readiness
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="dash-systemStatusBackButton"
        >
          Back to Dashboard
        </button>
      </header>
      <div className="dash-systemStatusContent">
        <SystemStatusPanel />
      </div>
    </div>
  );
}

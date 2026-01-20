"use client";

import React from "react";
import { useRouter } from "next/navigation";

import { SystemStatusPanel } from "~/components/dashboard";

export default function SystemStatusPage() {
  const router = useRouter();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#1e1e1e",
        color: "#e5e5e5",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "1px solid #333",
          backgroundColor: "#252526",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
          System Status
        </h2>
        <button
          onClick={() => router.push("/")}
          style={{
            padding: "8px 16px",
            backgroundColor: "#333",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Back to Dashboard
        </button>
      </div>

      <div style={{ padding: "24px", overflow: "auto", flex: 1 }}>
        <SystemStatusPanel />
      </div>
    </div>
  );
}

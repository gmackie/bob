"use client";

import React, { useEffect, useState } from "react";

interface AgentInfo {
  type: string;
  name?: string;
  version?: string;
  isAvailable: boolean;
  isAuthenticated?: boolean;
  authenticationStatus?: string;
  statusMessage?: string;
  pathInfo?: {
    path: string;
    exists: boolean;
  };
}

interface HostDependency {
  name: string;
  isAvailable: boolean;
  version?: string;
  statusMessage?: string;
}

interface SystemStatusResponse {
  timestamp: string;
  agents: AgentInfo[];
  hostDependencies: HostDependency[];
}

export function SystemStatusPanel() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system-status", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={headerWrapperStyle}>
          <h3 style={headerStyle}>System Status</h3>
          <span style={loadingTextStyle}>Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={panelStyle}>
        <div style={headerWrapperStyle}>
          <h3 style={headerStyle}>System Status</h3>
          <div style={errorStyle}>
            <span>Error: {error}</span>
            <button onClick={fetchData} style={retryBtnStyle}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={panelStyle}>
      <div style={headerWrapperStyle}>
        <h3 style={headerStyle}>System Status</h3>
        <div style={metaStyle}>
          <span>Updated: {new Date(data.timestamp).toLocaleTimeString()}</span>
          <button onClick={fetchData} style={refreshBtnStyle} title="Refresh">
            Refresh
          </button>
        </div>
      </div>

      <div style={contentGridStyle}>
        {/* Agents Section */}
        <div style={sectionStyle}>
          <h4 style={sectionHeaderStyle}>Agents</h4>
          <table style={tableStyle}>
            <tbody>
              {data.agents.map((agent) => (
                <tr key={agent.type} style={rowStyle}>
                  <td style={cellNameStyle}>
                    {agent.name ||
                      agent.type.charAt(0).toUpperCase() + agent.type.slice(1)}
                  </td>
                  <td style={cellStatusStyle}>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        alignItems: "center",
                      }}
                    >
                      <span
                        title={agent.statusMessage}
                        style={{
                          ...statusBadgeStyle,
                          backgroundColor: agent.isAvailable
                            ? "#238636"
                            : "#da3633",
                        }}
                      >
                        {agent.isAvailable ? "Installed" : "Missing"}
                      </span>
                      {agent.isAvailable && (
                        <span
                          title={
                            agent.authenticationStatus ||
                            (agent.isAuthenticated
                              ? "Authenticated"
                              : "Not Authenticated")
                          }
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: agent.isAuthenticated
                              ? "#1f6feb"
                              : "#9a6700",
                          }}
                        >
                          {agent.isAuthenticated ? "Auth" : "No Auth"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={cellVersionStyle}>{agent.version || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Host Dependencies Section */}
        <div style={sectionStyle}>
          <h4 style={sectionHeaderStyle}>Host Dependencies</h4>
          <table style={tableStyle}>
            <tbody>
              {data.hostDependencies.map((dep) => (
                <tr key={dep.name} style={rowStyle}>
                  <td style={cellNameStyle}>{dep.name}</td>
                  <td style={cellStatusStyle}>
                    <span
                      style={{
                        ...statusBadgeStyle,
                        backgroundColor: dep.isAvailable
                          ? "#238636"
                          : "#da3633",
                      }}
                    >
                      {dep.isAvailable ? "OK" : "Missing"}
                    </span>
                  </td>
                  <td style={cellVersionStyle}>
                    {dep.version || dep.statusMessage || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Styles
const panelStyle: React.CSSProperties = {
  backgroundColor: "#0d1117",
  borderBottom: "1px solid #30363d",
  padding: "12px 20px",
  flexShrink: 0,
};

const headerWrapperStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
};

const headerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "14px",
  fontWeight: 600,
  color: "#e6edf3",
};

const loadingTextStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#8b949e",
};

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "12px",
  color: "#f85149",
};

const retryBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #f85149",
  color: "#f85149",
  borderRadius: "4px",
  padding: "2px 6px",
  fontSize: "11px",
  cursor: "pointer",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: "12px",
  color: "#8b949e",
};

const refreshBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#8b949e",
  cursor: "pointer",
  fontSize: "14px",
  padding: "0 4px",
};

const contentGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: "24px",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const sectionHeaderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "12px",
  color: "#8b949e",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "12px",
};

const rowStyle: React.CSSProperties = {
  borderBottom: "1px solid #21262d",
};

const cellNameStyle: React.CSSProperties = {
  padding: "6px 0",
  color: "#e6edf3",
  fontWeight: 500,
  width: "120px",
};

const cellStatusStyle: React.CSSProperties = {
  padding: "6px 8px",
};

const statusBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 6px",
  borderRadius: "10px",
  fontSize: "10px",
  fontWeight: 600,
  color: "#ffffff",
  lineHeight: "1.2",
};

const cellVersionStyle: React.CSSProperties = {
  padding: "6px 0",
  color: "#8b949e",
  fontFamily: "monospace",
  textAlign: "right",
};

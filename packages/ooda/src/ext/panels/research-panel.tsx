import { useState } from "react";

interface Exploration {
  id: string;
  query: string;
  status: "running" | "paused" | "complete";
  checkIns: number;
  lastCheckIn?: string;
}

export function ResearchPanel() {
  const [explorations, setExplorations] = useState<Exploration[]>([]);
  const [newQuery, setNewQuery] = useState("");
  const [showForm, setShowForm] = useState(false);

  const activeExploration = explorations.find((e) => e.status === "running");

  function handleStartExploration() {
    if (!newQuery.trim()) return;
    const exploration: Exploration = {
      id: crypto.randomUUID(),
      query: newQuery.trim(),
      status: "running",
      checkIns: 0,
    };
    setExplorations((prev) => [exploration, ...prev]);
    setNewQuery("");
    setShowForm(false);
  }

  return (
    <div style={{ padding: "12px" }}>
      <h3 style={{ margin: "0 0 12px" }}>Research</h3>

      {activeExploration ? (
        <div
          style={{
            padding: "8px",
            border: "1px solid #3b82f6",
            borderRadius: "6px",
            marginBottom: "12px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
            Active Exploration
          </div>
          <div style={{ fontSize: "13px", marginBottom: "8px" }}>
            {activeExploration.query}
          </div>
          <div
            style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}
          >
            {activeExploration.checkIns} check-ins
            {activeExploration.lastCheckIn &&
              ` \u00b7 last: ${activeExploration.lastCheckIn}`}
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() =>
                setExplorations((prev) =>
                  prev.map((e) =>
                    e.id === activeExploration.id
                      ? { ...e, status: "paused" }
                      : e,
                  ),
                )
              }
            >
              Pause
            </button>
            <button
              onClick={() =>
                setExplorations((prev) =>
                  prev.map((e) =>
                    e.id === activeExploration.id
                      ? { ...e, status: "complete" }
                      : e,
                  ),
                )
              }
            >
              Complete
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "8px",
            color: "#888",
            fontSize: "13px",
            marginBottom: "12px",
          }}
        >
          No active exploration.
        </div>
      )}

      {showForm ? (
        <div style={{ marginBottom: "12px" }}>
          <input
            type="text"
            placeholder="Research question..."
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStartExploration()}
            style={{
              width: "100%",
              padding: "6px 8px",
              marginBottom: "6px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={handleStartExploration}>Start</button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} style={{ width: "100%" }}>
          Start Exploration
        </button>
      )}

      {explorations.filter((e) => e.status !== "running").length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div
            style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
          >
            Previous
          </div>
          {explorations
            .filter((e) => e.status !== "running")
            .map((e) => (
              <div
                key={e.id}
                style={{
                  fontSize: "13px",
                  padding: "4px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <span>{e.query}</span>
                <span
                  style={{
                    marginLeft: "8px",
                    fontSize: "11px",
                    color: e.status === "complete" ? "#22c55e" : "#f59e0b",
                  }}
                >
                  {e.status}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default ResearchPanel;

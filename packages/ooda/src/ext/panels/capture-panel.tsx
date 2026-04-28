import { useState } from "react";

export function CapturePanel() {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    if (!text.trim()) return;
    // TODO: integrate with t3code host API to create a new thread
    console.log("[ooda] capture:", text.trim());
    setText("");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  }

  return (
    <div style={{ padding: "12px" }}>
      <h3 style={{ margin: "0 0 12px" }}>Quick Capture</h3>

      <textarea
        placeholder="Jot down an idea, question, or observation..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        rows={4}
        style={{
          width: "100%",
          padding: "8px",
          resize: "vertical",
          boxSizing: "border-box",
          marginBottom: "8px",
        }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          style={{ padding: "6px 16px" }}
        >
          Capture
        </button>
        {submitted && (
          <span style={{ fontSize: "12px", color: "#22c55e" }}>Saved!</span>
        )}
      </div>

      <div style={{ fontSize: "11px", color: "#888", marginTop: "8px" }}>
        Cmd+Enter to submit
      </div>
    </div>
  );
}

export default CapturePanel;

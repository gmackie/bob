import { useState } from "react";

interface Article {
  id: string;
  title: string;
  excerpt: string;
  linkedCount: number;
  orphaned: boolean;
  updatedAt: string;
}

const PLACEHOLDER_ARTICLES: Article[] = [];

export function WikiPanel() {
  const [articles] = useState<Article[]>(PLACEHOLDER_ARTICLES);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = articles.filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase()),
  );

  const orphanedCount = articles.filter((a) => a.orphaned).length;
  const selected = articles.find((a) => a.id === selectedId);

  if (selected) {
    return (
      <div style={{ padding: "12px" }}>
        <button
          onClick={() => setSelectedId(null)}
          style={{ marginBottom: "8px", cursor: "pointer" }}
        >
          &larr; Back
        </button>
        <h3 style={{ margin: "0 0 8px" }}>{selected.title}</h3>
        <p style={{ fontSize: "13px", color: "#666" }}>{selected.excerpt}</p>
        <div style={{ fontSize: "12px", color: "#888", marginTop: "8px" }}>
          {selected.linkedCount} links &middot; Updated {selected.updatedAt}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px" }}>
      <h3 style={{ margin: "0 0 12px" }}>Wiki</h3>

      <input
        type="text"
        placeholder="Search articles..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "6px 8px",
          marginBottom: "8px",
          boxSizing: "border-box",
        }}
      />

      {orphanedCount > 0 && (
        <div
          style={{
            fontSize: "12px",
            color: "#f59e0b",
            marginBottom: "8px",
          }}
        >
          {orphanedCount} orphaned article{orphanedCount !== 1 && "s"}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ fontSize: "13px", color: "#888", padding: "16px 0" }}>
          {articles.length === 0
            ? "No articles yet. Start a research exploration to generate wiki entries."
            : "No matching articles."}
        </div>
      ) : (
        <div>
          {filtered.map((article) => (
            <div
              key={article.id}
              onClick={() => setSelectedId(article.id)}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid #eee",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 500 }}>
                {article.title}
                {article.orphaned && (
                  <span
                    style={{
                      marginLeft: "6px",
                      fontSize: "10px",
                      color: "#f59e0b",
                    }}
                  >
                    orphaned
                  </span>
                )}
              </div>
              <div style={{ fontSize: "12px", color: "#888" }}>
                {article.excerpt.slice(0, 80)}
                {article.excerpt.length > 80 && "..."}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WikiPanel;
